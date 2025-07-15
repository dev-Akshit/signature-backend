import { Worker } from 'bullmq';
import Redis from 'ioredis';
import * as templateServices from '../services/templates.js';
import * as signatureServices from '../services/signature.js';
import Court from '../models/courts.js';
import fs from 'fs';
import path from 'path';
import PizZip from 'pizzip';
import Docxtemplater from 'docxtemplater';
import ImageModule from 'docxtemplater-image-module-free';
import QRCode from 'qrcode';
import libre from 'libreoffice-convert';
// import mongoose from '../config/mongoose.js';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { signStatus, status } from '../constants/index.js';
import mongoose from 'mongoose';
import { getIO } from '../libs/utils.js';
mongoose.connect('mongodb://localhost:27017/test').then(() => {
  console.log('MongoDB connected in worker');
}).catch((err) => {
  console.error('MongoDB connection error in worker:', err);
});

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const redisConnection = new Redis({
  host: 'localhost',
  port: 6379,
  maxRetriesPerRequest: null,
});

const convertToPDF = (docxBuf) => {
  return new Promise((resolve, reject) => {
    libre.convert(docxBuf, '.pdf', undefined, (err, pdfBuf) => {
      if (err) return reject(err);
      resolve(pdfBuf);
    });
  });
};

export const signWorker = new Worker('sign-request', async (job) => {
  let io;
  try {
    // console.log('Processing job:', job.data);
    io = getIO();

    io.emit('requestStatusUpdate', {
      requestId: job.data.requestId,
      status: 'inProcess',
    })
    const { requestId, userId, signatureId, courtId } = job.data;

    const court = await Court.findOne({ id: courtId });
    const courtName = court?.name || 'Unknown Court';
    const request = await templateServices.findOne({ id: requestId });
    if (!request || !request.url) throw new Error('Invalid request or template missing');

    const signature = await signatureServices.findOne({ id: signatureId, userId });
    if (!signature) throw new Error('Signature not found');

    let totalDocuments = request.data.filter(doc => doc.signStatus !== signStatus.rejected).length;

    io.emit('signingRequest', {
      requestId,
      current: 0,
      total: totalDocuments,
    })

    const docxPath = path.resolve(__dirname, '../../', request.url);
    const signedDir = path.resolve(__dirname, '../uploads/signed', requestId);
    const qrCodeDir = path.resolve(__dirname, '../uploads/qrcodes', requestId);

    if (!fs.existsSync(signedDir)) fs.mkdirSync(signedDir, { recursive: true });
    if (!fs.existsSync(qrCodeDir)) fs.mkdirSync(qrCodeDir, { recursive: true });

    const signedDocuments = [];
    let i = 1;
    let currDocCount = 0;
    for (const document of request.data) {
      if (document.signStatus === signStatus.rejected) {
        signedDocuments.push(document);
        continue;
      }

      const zip = new PizZip(fs.readFileSync(docxPath, 'binary'));
      const docId = document.id.toString();

      const qrCodePath = path.join(qrCodeDir, `${docId}_qrcode.png`);
      const qrCodeUrl = `${process.env.FRONTEND_URL}/document/${docId}`;
      //   console.log('Generating QR for:', docId);
      await QRCode.toFile(qrCodePath, qrCodeUrl);

      const imageModule = new ImageModule({
        getImage: (tag) => {
          const fileName = path.basename(tag);
          const signaturePath = path.resolve(__dirname, '../uploads/signatures', fileName);
          const qrPath = path.resolve(__dirname, '../uploads/qrcodes', requestId, fileName);

          if (fs.existsSync(signaturePath)) return fs.readFileSync(signaturePath);
          if (fs.existsSync(qrPath)) return fs.readFileSync(qrPath);

          throw new Error(`Image file not found at ${signaturePath} or ${qrPath}`);
        },
        getSize: (tag) => tag.includes('qrCode') ? [250, 250] : [150, 100],
        parser: (tag) => ['Signature', 'qrCode'].includes(tag),
      });

      const doc = new Docxtemplater(zip, {
        paragraphLoop: true,
        linebreaks: true,
        modules: [imageModule],
      });

      const data = document.data || {};
      data['Signature'] = signature.url;
      data['Court'] = courtName;
      data['qrCode'] = qrCodePath;

      console.log("Signing document:", i++);

      doc.render(data);
      const filledDocxBuf = doc.getZip().generate({ type: 'nodebuffer' });
      const pdfBuf = await convertToPDF(filledDocxBuf);

      const pdfPath = path.join(signedDir, `${docId}_signed.pdf`);
      fs.writeFileSync(pdfPath, pdfBuf);

      signedDocuments.push({
        ...document,
        signedPath: pdfPath,
        qrCodePath,
        signedDate: new Date(),
        signStatus: signStatus.Signed,
      });
      currDocCount++;
      io.emit('signingRequest', {
        requestId,
        current: currDocCount,
        total: totalDocuments,
      })
    }

    io.emit('requestStatusUpdate', {
      requestId: job.data.requestId,
      status: 'Signed',
    });

    await templateServices.updateOne(
      { id: requestId },
      {
        $set: {
          data: signedDocuments,
          signStatus: signStatus.Signed,
          updatedAt: new Date(),
          updatedBy: userId,
        },
      }
    );

    console.log('Successfully signed all documents.');
  } catch (err) {
    console.error('Error processing sign-request job:', err);
  }

  console.log('Worker finished processing.\n');
}, { connection: redisConnection, concurrency: 3 });
