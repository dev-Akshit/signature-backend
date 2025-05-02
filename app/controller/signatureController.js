import * as templateServices from '../services/templates.js';
import * as signatureServices from '../services/signature.js';
import { SendForSignatureSchema } from '../schema/request.js';
import mongoose from 'mongoose';
import { userServices } from '../services/index.js';
import Court from '../models/courts.js';
import fs from 'fs';
import path from 'path';
import PizZip from 'pizzip';
import Docxtemplater from 'docxtemplater';
import ImageModule from 'docxtemplater-image-module-free';
import QRCode from 'qrcode';
import { roles, status, signStatus } from '../constants/index.js';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import libre from 'libreoffice-convert';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const convertToPDF = (docxBuf) => {
    return new Promise((resolve, reject) => {
        libre.convert(docxBuf, '.pdf', undefined, (err, pdfBuf) => {
            if (err) {
                reject(err);
                return;
            }
            resolve(pdfBuf);
        });
    });
};

export const sendForSignature = async (req, res, next) => {
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

        if (request.data.length === 0) {
            return res.status(400).json({ error: 'Cannot send request without documents' });
        }

        const body = await SendForSignatureSchema.safeParseAsync(req.body);
        if (!body.success) {
            return res.status(400).json({
                error: 'Invalid payload',
                detailed: body.error,
            });
        }

        const { officerId } = body.data;
        const officer = await userServices.findOne({
            id: officerId,
            role: roles.officer,
            status: status.active,
        });

        if (!officer) {
            return res.status(400).json({ error: 'Invalid officer' });
        }

        const updatedTemplate = await templateServices.updateOne(
            { id },
            {
                $set: {
                    signStatus: signStatus.readForSign,
                    assignedTo: mongoose.Types.ObjectId.isValid(officerId)
                        ? new mongoose.Types.ObjectId(officerId)
                        : officerId,
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
            })),
        });
    } catch (error) {
        console.error('POST /api/requests/:id/send error:', error);
        next(error);
    }
};

export const signRequest = async (req, res, next) => {
    try {
        const { id } = req.params;
        const userId = req.session.userId;
        const { signatureId } = req.body;
        const court = await Court.findOne({ id: req.session.courtId });
        if (!court) {
            return res.status(400).json({ error: 'Court not found' });
        }
        const courtName = court.name;

        if (!userId) {
            return res.status(403).json({ error: 'User not assigned' });
        }

        if (!signatureId) {
            return res.status(400).json({ error: 'SignatureId is required' });
        }

        const userObjectId = mongoose.Types.ObjectId.isValid(userId)
            ? new mongoose.Types.ObjectId(userId)
            : null;

        if (!userObjectId) {
            return res.status(400).json({ error: 'Invalid user ID format' });
        }
        console.log('User Object ID:', userObjectId);

        const query = {
            id,
            status: status.active,
        };

        const request = await templateServices.findOne(query);

        if (!request) {
            return res.status(404).json({ error: 'Request not found or not assigned to you' });
        }

        if (!request.url) {
            return res.status(400).json({ error: 'No template file associated with this request' });
        }

        let signature = await signatureServices.findOne({ id: signatureId, userId });
        if (!signature) {
            return res.status(404).json({ error: 'Signature not found or access denied' });
        }

        const docxPath = path.resolve(__dirname, '../../', request.url);
        if (!fs.existsSync(docxPath)) {
            return res.status(404).json({ error: 'Template file not found' });
        }

        // Create request-specific signed directory
        const signedDir = path.resolve(__dirname, '../uploads/signed', id);
        if (!fs.existsSync(signedDir)) {
            fs.mkdirSync(signedDir, { recursive: true });
        }

        // Temporary directory for QR codes
        const qrCodeDir = path.resolve(__dirname, '../uploads/qrcodes', id);
        if (!fs.existsSync(qrCodeDir)) {
            fs.mkdirSync(qrCodeDir, { recursive: true });
        }

        const signedDocuments = [];
        for (const document of request.data) {
            if (document.signStatus === signStatus.rejected) {
                signedDocuments.push(document);
                continue;
            }
            const content = fs.readFileSync(docxPath, 'binary');
            const zip = new PizZip(content);

            const imageModule = new ImageModule({
                centered: false,
                getImage: function (tagValue) {
                    let normalizedPath = tagValue.replace(/\\/g, '/');
                    if (normalizedPath.startsWith('/')) {
                        normalizedPath = normalizedPath.slice(1);
                    }
                    let imagePath = path.resolve(__dirname, '../', normalizedPath);
                    if (!fs.existsSync(imagePath)) {
                        const fileName = path.basename(normalizedPath);
                        const altPath = path.resolve(__dirname, '../uploads/signatures', fileName);
                        if (fs.existsSync(altPath)) {
                            return fs.readFileSync(altPath);
                        }
                        // Check QR code directory
                        const qrPath = path.resolve(__dirname, '../uploads/qrcodes', id, fileName);
                        if (fs.existsSync(qrPath)) {
                            return fs.readFileSync(qrPath);
                        }
                        throw new Error(`Image file not found at ${imagePath}, ${altPath}, or ${qrPath}`);
                    }
                    return fs.readFileSync(imagePath);
                },
                getSize: function (tagValue) {
                    if (tagValue.includes('qrcode')) {
                        return [250, 250];
                    }
                    return [150, 100];
                },
                parser: function (tag) {
                    return tag === 'Signature' || tag === 'qrCode';
                },
            });

            const doc = new Docxtemplater(zip, {
                paragraphLoop: true,
                linebreaks: true,
                modules: [imageModule],
            });

            const data = document.data instanceof Map ? Object.fromEntries(document.data) : document.data || {};
            const signaturePath = signature.url.replace(/\\/g, '/');
            data['Signature'] = signaturePath;
            data['Court'] = courtName;

            const documentId = document.id.toString();
            const qrCodeUrl = `${process.env.FRONTEND_URL}/document/${documentId}`;
            const qrCodeFileName = `${documentId}_qrcode.png`;
            const qrCodePath = path.join(qrCodeDir, qrCodeFileName);
            await QRCode.toFile(qrCodePath, qrCodeUrl, {
                width: 100,
                margin: 1,
            });
            data['qrCode'] = qrCodePath.replace(/\\/g, '/');

            try {
                doc.render(data);
            } catch (error) {
                console.error('Docxtemplater render error:', error);
                return res.status(500).json({
                    error: `Failed to render document ${document.id}`,
                    details: error.message,
                });
            }

            const filledDocxBuf = doc.getZip().generate({
                type: 'nodebuffer',
                compression: 'DEFLATE',
            });

            let pdfBuf;
            try {
                pdfBuf = await convertToPDF(filledDocxBuf);
            } catch (error) {
                console.error('PDF conversion error:', error);
                return res.status(500).json({
                    error: `Failed to convert document ${document.id} to PDF`,
                    details: error.message,
                });
            }

            const signedPdfPath = path.join(signedDir, `${document.id}_signed.pdf`);
            fs.writeFileSync(signedPdfPath, pdfBuf);

            const updatedDocument = { ...document };
            updatedDocument.signedPath = signedPdfPath;
            updatedDocument.signStatus = signStatus.Signed;
            updatedDocument.signedDate = new Date();
            updatedDocument.qrCodePath = qrCodePath;
            signedDocuments.push(updatedDocument);
        }

        await templateServices.updateOne(
            { id },
            {
                $set: {
                    data: signedDocuments,
                    signStatus: signStatus.Signed,
                    updatedAt: new Date(),
                    updatedBy: userObjectId,
                },
            }
        );

        return res.json({
            message: 'Request signed successfully',
            signedDocuments: signedDocuments.map(doc => ({
                id: doc.id.toString(),
                name: doc.data && doc.data.name ? doc.data.name : 'Document',
                signedPath: `/uploads/signed/${id}/${doc.id}_signed.pdf`,
                qrCodePath: `/uploads/qrcodes/${id}/${doc.id}_qrcode.png`,
                signedDate: doc.signedDate,
            })),
        });
    } catch (error) {
        console.error('POST /api/requests/:id/sign error:', error);
        next(error);
    }
};

export const rejectRequest = async (req, res, next) => {
    try {
        const id = req.params.id;
        const { rejectionReason } = req.body;
        console.log('Reject request received:', { id, rejectionReason });

        if (!rejectionReason || typeof rejectionReason !== 'string' || rejectionReason.trim().length === 0) {
            return res.status(400).json({ error: 'Rejection reason is required and must be a non-empty string' });
        }

        const userObjectId = mongoose.Types.ObjectId.isValid(req.session.userId)
            ? new mongoose.Types.ObjectId(req.session.userId)
            : null;

        if (!userObjectId) {
            return res.status(400).json({ error: 'Invalid user ID format' });
        }

        const template = await templateServices.findOne({
            id,
            signStatus: signStatus.readForSign,
            assignedTo: userObjectId,
            status: status.active,
        });

        if (!template) {
            return res.status(404).json({ error: 'Request not found or unauthorized' });
        }

        const rejectedDocuments = template.data.map(doc => ({
            ...doc,
            signStatus: signStatus.rejected,
            rejectionReason: rejectionReason.trim(),
            rejectedDate: new Date()
        }));

        const updatedTemplate = await templateServices.updateOne(
            { id },
            {
                $set: {
                    data: rejectedDocuments,
                    signStatus: signStatus.rejected,
                    rejectionReason: rejectionReason.trim(),
                    updatedBy: userObjectId,
                    updatedAt: new Date(),
                },
            }
        );

        console.log('Updated template with rejectionReason:', updatedTemplate);

        return res.json({
            id: template.id.toString(),
            title: template.templateName,
            documentCount: template.data.length,
            rejectedCount: rejectedDocuments.length,
            createdAt: template.createdAt.toISOString(),
            status: signStatus.rejected,
            rejectionReason: rejectionReason.trim(),
            description: template.description || '',
            documents: rejectedDocuments.map((d) => ({
                id: d.id.toString(),
                name: d.data.name || 'Document',
                filePath: d.url,
                uploadedAt: d.createdAt?.toISOString() || template.createdAt.toISOString(),
                rejectionReason: d.rejectionReason,
                rejectedDate: d.rejectedDate
            })),
        });
    } catch (error) {
        console.error('POST /api/requests/:id/reject error:', error);
        next(error);
    }
};

export const getDocumentData = async (req, res, next) => {
    try {
        const { documentId } = req.params;

        const template = await templateServices.findOne(
            { 'data.id': mongoose.Types.ObjectId.isValid(documentId) ? new mongoose.Types.ObjectId(documentId) : documentId },
            { 'data.$': 1, templateName: 1, description: 1 }
        );

        if (!template) {
            return res.status(404).json({ error: 'Template not found' });
        }

        const document = template.data[0];
        if (!document) {
            return res.status(404).json({ error: 'Document not found' });
        }

        return res.json({
            documentId: document.id.toString(),
            templateName: template.templateName,
            description: template.description || '',
            data: document.data instanceof Map ? Object.fromEntries(document.data) : document.data || {},
            signedDate: document.signedDate?.toISOString(),
            signedPath: document.signedPath || '',
            qrCodePath: document.qrCodePath || '',
        });
    } catch (error) {
        console.error('GET /api/documents/:documentId error:', error);
        next(error);
    }
};

export const rejectDocument = async (req, res, next) => {
    try {
        const { id, documentId } = req.params;
        const { rejectionReason } = req.body;
        console.log('Reject document received:', { id, documentId, rejectionReason });

        if (!rejectionReason || typeof rejectionReason !== 'string' || rejectionReason.trim().length === 0) {
            return res.status(400).json({ error: 'Rejection reason is required and must be a non-empty string' });
        }

        const request = await templateServices.findOne({
            id,
            signStatus: signStatus.readForSign,
            assignedTo: mongoose.Types.ObjectId.isValid(req.session.userId)
                ? new mongoose.Types.ObjectId(req.session.userId)
                : req.session.userId,
            status: status.active,
            'data.id': mongoose.Types.ObjectId.isValid(documentId)
                ? new mongoose.Types.ObjectId(documentId)
                : documentId,
        });

        if (!request) {
            return res.status(404).json({ error: 'Request not found or unauthorized' });
        }

        const updatedDocument = await templateServices.updateOne(
            {
                id,
                'data.id': mongoose.Types.ObjectId.isValid(documentId)
                    ? new mongoose.Types.ObjectId(documentId)
                    : documentId,
            },
            {
                $set: {
                    'data.$.signStatus': signStatus.rejected,
                    'data.$.rejectionReason': rejectionReason.trim(),
                    'data.$.rejectedDate': new Date(),
                    updatedBy: mongoose.Types.ObjectId.isValid(req.session.userId)
                        ? new mongoose.Types.ObjectId(req.session.userId)
                        : req.session.userId,
                    updatedAt: new Date(),
                },
            }
        );
        console.log('Updated document with rejectionReason:', updatedDocument);

        return res.json({
            message: 'Document rejected successfully',
            documentId,
            rejectionReason: rejectionReason.trim(),
        });
    } catch (error) {
        console.error('POST /api/requests/:requestId/documents/:documentId/reject error:', error);
        next(error);
    }
}

export const delegateRequest = async (req, res, next) => {
    try {
        const id = req.params.id;
        const template = await templateServices.findOne({
            id,
            signStatus: signStatus.readForSign,
            assignedTo: mongoose.Types.ObjectId.isValid(req.session.userId)
                ? new mongoose.Types.ObjectId(req.session.userId)
                : req.session.userId,
            status: status.active,
        });

        if (!template) {
            return res.status(404).json({ error: 'Request not found or unauthorized' });
        }

        const readerId = template.createdBy;
        // console.log('Reader ID:', readerId);

        const updatedRequest = await templateServices.updateOne(
            { id },
            {
                $set: {
                    signStatus: signStatus.delegated,
                    delegatedTo: mongoose.Types.ObjectId.isValid(readerId)
                        ? new mongoose.Types.ObjectId(readerId)
                        : readerId,
                    // delegationReason: req.body.reason || 'No reason provided',
                    updatedBy: mongoose.Types.ObjectId.isValid(req.session.userId)
                        ? new mongoose.Types.ObjectId(req.session.userId)
                        : req.session.userId,
                    updatedAt: new Date(),
                },
            }
        );

        return res.json({
            id: updatedRequest.id.toString(),
            title: updatedRequest.templateName,
            documentCount: updatedRequest.data.length,
            rejectedCount: updatedRequest.data.filter(d => d.signStatus === signStatus.rejected).length,
            createdAt: updatedRequest.createdAt.toISOString(),
            status: updatedRequest.signStatus,
            description: updatedRequest.description || '',
            documents: updatedRequest.data.map(d => ({
                id: d.id.toString(),
                name: 'Document',
                filePath: d.url,
                uploadedAt: d.createdAt?.toISOString() || updatedRequest.createdAt.toISOString(),
            })),
        });
    } catch (error) {
        console.error('POST /api/requests/:id/delegate error:', error);
        next(error);
    }
}