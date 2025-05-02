import * as templateServices from '../services/templates.js';
import { RequestCreationSchema } from '../schema/request.js';
import mongoose from 'mongoose';
import { extractTemplateVariables } from '../libs/utils.js';
import { roles, status, signStatus } from '../constants/index.js';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import archiver from 'archiver';
import { PDFDocument } from 'pdf-lib';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export const createRequest = async (req, res, next) => {
  try {
    const file = req.file;

    const body = await RequestCreationSchema.safeParseAsync({
      title: req.body.title,
      description: req.body.description,
      templateFile: req.file ? req.file.path : undefined,
    });

    if (!body.success) {
      return res.status(400).json({
        error: 'Invalid payload',
        detailed: body.error,
      });
    }

    const { title, description, templateFile } = body.data;
    const templateVariables = await extractTemplateVariables(templateFile);

    const creationObj = {
      id: new mongoose.Types.ObjectId(),
      url: templateFile,
      status: status.active,
      signStatus: signStatus.unsigned,
      templateName: title,
      description: description || '',
      templateVariables,
      createdBy: mongoose.Types.ObjectId.isValid(req.session.userId)
        ? new mongoose.Types.ObjectId(req.session.userId)
        : req.session.userId,
      updatedBy: mongoose.Types.ObjectId.isValid(req.session.userId)
        ? new mongoose.Types.ObjectId(req.session.userId)
        : req.session.userId,
      data: [],
    };

    const request = await templateServices.save(creationObj);

    return res.json({
      id: request.id.toString(),
      title: request.templateName,
      documentCount: request.data.length,
      rejectedCount: 0,
      createdAt: request.createdAt.toISOString(),
      status: request.signStatus,
      url: request.url ? `/Uploads/templates/${file.filename}` : '',
      description: request.description,
      templateVariables: request.templateVariables,
      documents: [],
    });
  } catch (error) {
    console.error('POST /api/requests error:', error);
    next(error);
  }
};

export const getAllRequests = async (req, res, next) => {
  try {
    const userId = req.session.userId;
    if (!userId) {
      return res.status(403).json({ error: 'User not assigned' });
    }

    const query = {
      status: status.active,
    };

    if (req.session.role === roles.reader) {
      query.createdBy = mongoose.Types.ObjectId.isValid(userId)
        ? new mongoose.Types.ObjectId(userId)
        : userId;
    } else if (req.session.role === roles.officer) {
      query.assignedTo = mongoose.Types.ObjectId.isValid(userId)
        ? new mongoose.Types.ObjectId(userId)
        : userId;
    }

    if (req.query.search) {
      query.templateName = { $regex: String(req.query.search), $options: 'i' };
    }

    const requests = await templateServices.find(query);

    return res.json(
      requests.map((r) => ({
        id: r.id.toString(),
        title: r.templateName,
        documentCount: r.data.length,
        rejectedCount: r.data.filter((d) => d.signStatus === signStatus.rejected).length,
        createdAt: r.createdAt.toISOString(),
        status: r.signStatus,
        description: r.description || '',
        rejectionReason: r.rejectionReason || '',
        documents: r.data.map((d) => ({
          id: d.id.toString(),
          name: d?.data?.name || 'Document',
          filePath: d.url,
          uploadedAt: d.createdAt?.toISOString() || r.createdAt.toISOString(),
          signStatus: d.signStatus,
          signedDate: d.signedDate?.toISOString(),
          data: d.data && typeof d.data === 'object' ? d.data : {},
        })),
      }))
    );
  } catch (error) {
    console.error('GET /api/requests error:', error);
    next(error);
  }
};

export const getRequestById = async (req, res, next) => {
  try {
    const id = req.params.id;
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
      return res.status(404).json({ error: 'Request not found' });
    }

    const documents = (request.data || []).map((d) => ({
      id: d.id.toString(),
      name: d?.data?.name || 'Document',
      filePath: d.url,
      uploadedAt: d.createdAt?.toISOString() || request.createdAt.toISOString(),
      signStatus: d.signStatus,
      signedDate: d.signedDate?.toISOString(),
      data: d.data instanceof Map ? Object.fromEntries(d.data) : d.data || {},
    }));

    return res.json({
      id: request._id.toString(),
      title: request.templateName,
      documentCount: request.data?.length || 0,
      rejectedCount: (request.data || []).filter((d) => d.signStatus === signStatus.rejected).length,
      createdAt: request.createdAt.toISOString(),
      status: request.signStatus,
      url: request.url ? `/Uploads/templates/${path.basename(request.url)}` : '',
      description: request.description || '',
      templateVariables: request.templateVariables || [],
      documents,
    });
  } catch (error) {
    console.error('GET /api/requests/:id error:', error);
    next(error);
  }
};

export const cloneRequest = async (req, res, next) => {
  try {
    const id = req.params.id;
    const request = await templateServices.findOne({
      id,
      status: status.active,
    });

    if (!request) {
      return res.status(404).json({ error: 'Request not found' });
    }

    const cloneObj = {
      id: new mongoose.Types.ObjectId(),
      url: request.url,
      status: status.active,
      signStatus: signStatus.unsigned,
      templateName: `${request.templateName} (Clone)`,
      description: request.description || '',
      templateVariables: request.templateVariables || [],
      createdBy: mongoose.Types.ObjectId.isValid(req.session.userId)
        ? new mongoose.Types.ObjectId(req.session.userId)
        : req.session.userId,
      updatedBy: mongoose.Types.ObjectId.isValid(req.session.userId)
        ? new mongoose.Types.ObjectId(req.session.userId)
        : req.session.userId,
      data: [],
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const clonedRequest = await templateServices.save(cloneObj);

    return res.json({
      id: clonedRequest.id.toString(),
      title: clonedRequest.templateName,
      documentCount: clonedRequest.data.length,
      rejectedCount: 0,
      createdAt: clonedRequest.createdAt.toISOString(),
      status: clonedRequest.signStatus,
      description: clonedRequest.description || '',
      documents: [],
    });
  } catch (error) {
    console.error('POST /api/requests/:id/clone error:', error);
    next(error);
  }
};

export const deleteRequest = async (req, res, next) => {
  try {
    const id = req.params.id;
    const template = await templateServices.findOne({
      id,
      signStatus: signStatus.unsigned,
      createdBy: mongoose.Types.ObjectId.isValid(req.session.userId)
        ? new mongoose.Types.ObjectId(req.session.userId)
        : req.session.userId,
      status: status.active,
    });

    if (!template) {
      return res.status(404).json({ error: 'Request not found or unauthorized' });
    }

    await templateServices.updateOne(
      { id },
      {
        $set: {
          status: status.deleted,
          updatedBy: mongoose.Types.ObjectId.isValid(req.session.userId)
            ? new mongoose.Types.ObjectId(req.session.userId)
            : req.session.userId,
          updatedAt: new Date(),
        },
      }
    );

    return res.json({ id });
  } catch (error) {
    console.error('DELETE /api/requests/:id error:', error);
    next(error);
  }
};

export const printRequest = async (req, res, next) => {
  try {
    const { id } = req.params;
    const request = await templateServices.findOne({
      id,
      status: status.active,
      signStatus: signStatus.Signed,
    });

    if (!request) {
      return res.status(404).json({ error: 'Request not found or not signed' });
    }

    const signedDir = path.resolve(__dirname, '../Uploads/signed', id);
    if (!fs.existsSync(signedDir)) {
      return res.status(404).json({ error: 'No signed documents found' });
    }

    const signedFiles = fs.readdirSync(signedDir).filter(file => file.endsWith('_signed.pdf'));
    if (signedFiles.length === 0) {
      return res.status(404).json({ error: 'No signed PDFs available' });
    }

    // Merge all PDFs
    const mergedPdf = await PDFDocument.create();
    for (const file of signedFiles) {
      const pdfPath = path.join(signedDir, file);
      const pdfBytes = fs.readFileSync(pdfPath);
      const pdf = await PDFDocument.load(pdfBytes);
      const copiedPages = await mergedPdf.copyPages(pdf, pdf.getPageIndices());
      copiedPages.forEach(page => mergedPdf.addPage(page));
    }

    const pdfBuffer = await mergedPdf.save();

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'inline; filename=signed_documents.pdf');
    res.send(pdfBuffer);
  } catch (error) {
    console.error('POST /api/requests/:id/print error:', error);
    next(error);
  }
};

export const downloadZip = async (req, res, next) => {
    try {
        const { id } = req.params;
        const request = await templateServices.findOne({
            id,
            status: status.active,
            signStatus: signStatus.Signed,
        });

        if (!request) {
            return res.status(404).json({ error: 'Request not found or not signed' });
        }

        const signedDir = path.resolve(__dirname, '../Uploads/signed', id);
        if (!fs.existsSync(signedDir)) {
            return res.status(404).json({ error: 'No signed documents found' });
        }

        const signedFiles = fs.readdirSync(signedDir).filter(file => file.endsWith('_signed.pdf'));
        if (signedFiles.length === 0) {
            return res.status(404).json({ error: 'No signed PDFs available' });
        }

        // Create a ZIP archive
        const archive = archiver('zip', { zlib: { level: 9 } });
        res.setHeader('Content-Type', 'application/zip');
        res.setHeader('Content-Disposition', `attachment; filename=${id}_signed_documents.zip`);

        archive.pipe(res);

        signedFiles.forEach(file => {
            const filePath = path.join(signedDir, file);
            archive.file(filePath, { name: file });
        });

        await archive.finalize();
    } catch (error) {
        console.error('POST /api/requests/:id/download-zip error:', error);
        next(error);
    }
};