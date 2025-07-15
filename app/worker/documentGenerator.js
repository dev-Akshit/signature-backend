import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import PizZip from 'pizzip';
import Docxtemplater from 'docxtemplater';
import { Worker } from 'bullmq';
import Redis from 'ioredis';
import * as templateServices from '../services/templates.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const redisConnection = new Redis({ host: 'redis', port: 6379 });

const docWorker = new Worker('document-generation', async (job) => {
    const { id, templatePath, dataEntries, userId } = job.data;
    const docDir = path.resolve(__dirname, '../Uploads/documents', id);
    if (!fs.existsSync(docDir)) fs.mkdirSync(docDir, { recursive: true });

    for (const entry of dataEntries) {
      const content = fs.readFileSync(templatePath, 'binary');
      const zip = new PizZip(content);
      const doc = new Docxtemplater(zip, {
        paragraphLoop: true,
        linebreaks: true,
      });

      doc.render(entry.data);
      const buffer = doc.getZip().generate({ type: 'nodebuffer' });
      const docPath = path.join(docDir, `${entry.id}.docx`);
      fs.writeFileSync(docPath, buffer);

      await templateServices.updateOne(
        { id, 'data.id': entry.id },
        {
          $set: {
            'data.$.url': docPath,
            'data.$.createdAt': new Date(),
          },
        }
      );
    }
  },
  {
    connection: redisConnection,
    concurrency: 10,
  }
);

console.log('Document generation worker is running...');
