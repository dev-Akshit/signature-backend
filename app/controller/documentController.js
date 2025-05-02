import * as templateServices from '../services/templates.js';
import { DocumentUploadSchema } from '../schema/request.js';
import mongoose from 'mongoose';
import fs from 'fs';
import path from 'path';
import PizZip from 'pizzip';
import Docxtemplater from 'docxtemplater';
import { convertAsync } from '../libs/utils.js';
import { roles, status, signStatus } from '../constants/index.js';

export const convertToPDF = async (req, res, next) => {
  try {
    const { id } = req.params;
    const userRole = req.session.role;
    const userId = req.session.userId;

    let filter = { _id: new mongoose.Types.ObjectId(id), status: { $ne: status.deleted } };
    if (userRole === roles.reader) {
      filter.createdBy = userId;
    } else if (userRole === roles.officer) {
      filter = {
        _id: new mongoose.Types.ObjectId(id),
        $or: [{ createdBy: userId }, { assignedTo: userId }],
        status: { $ne: status.deleted },
      };
    }

    const template = await templateServices.findOne(filter);
    if (!template) {
      return res.status(404).json({ error: 'Template not found or unauthorized' });
    }

    const content = await fs.promises.readFile(template.url);
    const zip = new PizZip(content);
    const doc = new Docxtemplater(zip, {
      paragraphLoop: true,
      linebreaks: true,
      nullGetter: (part) => `${part.value}`,
    });

    doc.render({});

    const docBuffer = doc.getZip().generate({ type: 'nodebuffer' });

    const pdfBuffer = await convertAsync(docBuffer, '.pdf', undefined);
    const base64Pdf = pdfBuffer.toString('base64');
    res.json({ pdf: base64Pdf });
  } catch (error) {
    console.error('GET /api/requests/:id/pdf error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const uploadDocuments = async (req, res, next) => {
  try {
    const id = req.params.id;
    const request = await templateServices.findOne({
      id,
      signStatus: signStatus.unsigned,
      createdBy: mongoose.Types.ObjectId.isValid(req.session.userId)
        ? new mongoose.Types.ObjectId(req.session.userId)
        : req.session.userId,
      status: status.active,
    });

    if (!request) {
      return res.status(404).json({ error: 'Request not found or unauthorized' });
    }

    const dataEntries = req.body.dataEntries ? JSON.parse(req.body.dataEntries) : [];

    const body = await DocumentUploadSchema.safeParseAsync({
      documents: req.files,
      dataEntries,
    });

    if (!body.success) {
      console.error('Validation error:', body.error);
      return res.status(400).json({
        error: 'Invalid payload',
        detailed: body.error,
      });
    }

    const files = Array.isArray(req.files) ? req.files : [];

    const mappedEntries = dataEntries.map((entry) => ({
      id: new mongoose.Types.ObjectId(entry.id || undefined),
      url: files.find((f) => f.originalname === entry.url)?.path || entry.url || files[0]?.path,
      data: new Map(Object.entries(entry.data || {})),
      signStatus: entry.signStatus || signStatus.unsigned,
      createdAt: new Date(entry.createdAt || Date.now()),
    }));

    const updatedTemplate = await templateServices.updateOne(
      { id },
      {
        $push: { data: { $each: mappedEntries } },
        $set: {
          updatedBy: mongoose.Types.ObjectId.isValid(req.session.userId)
            ? new mongoose.Types.ObjectId(req.session.userId)
            : req.session.userId,
          updatedAt: new Date(),
        },
      }
    );

    return res.json({
      id: updatedTemplate.id.toString(),
      title: updatedTemplate.templateName,
      documentCount: updatedTemplate.data.length,
      rejectedCount: updatedTemplate.data.filter((d) => d.signStatus === signStatus.rejected).length,
      createdAt: updatedTemplate.createdAt.toISOString(),
      status: updatedTemplate.signStatus,
      description: updatedTemplate.description || '',
      documents: updatedTemplate.data.map((d) => ({
        id: d.id.toString(),
        name: d.data.name || 'Document',
        filePath: d.url,
        uploadedAt: d.createdAt?.toISOString() || updatedTemplate.createdAt.toISOString(),
        signedDate: d.signedDate?.toISOString() || undefined,
        signStatus: d.signStatus,
        data: Object.fromEntries(Object.entries(d.data || {})),
    })),
    });
  } catch (error) {
    console.error('POST /api/requests/:id/documents error:', error);
    next(error);
  }
};

export const previewDocument = async (req, res, next) => {
  try {
    const { id, documentId } = req.params;
    const userId = req.session.userId;
    if (!userId) {
      return res.status(403).json({ error: 'User not assigned' });
    }
    const userObjectId = mongoose.Types.ObjectId.isValid(userId)
      ? new mongoose.Types.ObjectId(userId)
      : null;
    if (!userObjectId) {
      return res.status(400).json({ error: 'Invalid user ID format' });
    }
    const query = {
      id,
      status: status.active,
    };
    if (req.session.role === roles.reader) {
      query.createdBy = userObjectId;
    } else if (req.session.role === roles.officer) {
      query.assignedTo = userObjectId;
    }
    const request = await templateServices.findOne(query);
    if (!request) {
      return res.status(404).json({ error: 'Request not found or unauthorized' });
    }
    const document = request.data.find((d) => d.id.toString() === documentId);
    if (!document) {
      return res.status(404).json({ error: 'Document not found' });
    }
    const docxPath = request.url;
    if (!docxPath) {
      return res.status(404).json({ error: 'Document not found on server' });
    }

    const content = fs.readFileSync(docxPath, 'binary');
    const zip = new PizZip(content);
    const doc = new Docxtemplater(zip, {
      paragraphLoop: true,
      linebreaks: true,
    });

    const data = document.data instanceof Map ? Object.fromEntries(document.data) : document.data;
    doc.render(data);

    const buffer = doc.getZip().generate({ type: 'nodebuffer' });

    const pdfBuffer = await convertAsync(buffer, '.pdf', undefined);
    const pdfFileName = `${path.basename(docxPath, path.extname(docxPath))}_preview.pdf`;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${pdfFileName}"`);
    res.setHeader('Content-Length', pdfBuffer.length);
    res.end(pdfBuffer);
  } catch (error) {
    console.error('GET /api/requests/:id/documents/:documentId/preview error:', error);
    next(error);
  }
};

export const deleteDocument = async (req, res, next) => {
  try {
    const { id, documentId } = req.params;
    const request = await templateServices.findOne({
      id,
      signStatus: signStatus.unsigned,
      createdBy: mongoose.Types.ObjectId.isValid(req.session.userId)
        ? new mongoose.Types.ObjectId(req.session.userId)
        : req.session.userId,
      status: status.active,
    });

    if (!request) {
      return res.status(404).json({ error: 'Request not found or unauthorized' });
    }

    const updatedTemplate = await templateServices.updateOne(
      { id },
      {
        $pull: { data: { id: new mongoose.Types.ObjectId(documentId) } },
        $set: {
          updatedBy: mongoose.Types.ObjectId.isValid(req.session.userId)
            ? new mongoose.Types.ObjectId(req.session.userId)
            : req.session.userId,
          updatedAt: new Date(),
        },
      }
    );

    if (!updatedTemplate) {
      return res.status(404).json({ error: 'Document not found' });
    }

    return res.json({ id, documentId });
  } catch (error) {
    console.error('DELETE /api/requests/:id/documents/:documentId error:', error);
    next(error);
  }
};