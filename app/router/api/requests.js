import { Router } from 'express';
import { checkLoginStatus } from '../../middleware/checkAuth.js';
import { checkReader, checkOfficer } from '../../middleware/checkRoles.js';
import { requestUpload } from '../../middleware/multer.js';
import * as requestController from '../../controller/requestController.js';
import * as documentController from '../../controller/documentController.js';
import * as signatureController from '../../controller/signatureController.js';

const router = Router();

// Request Routes
router.post(
  '/',
  checkLoginStatus,
  // checkReader,
  requestUpload.single('templateFile'),
  requestController.createRequest
);
router.get('/', checkLoginStatus, requestController.getAllRequests);
router.get('/:id', checkLoginStatus, requestController.getRequestById);
router.post('/:id/clone', checkLoginStatus, requestController.cloneRequest);
router.post('/:id/print', checkLoginStatus, requestController.printRequest);
router.post('/:id/download-zip', checkLoginStatus, requestController.downloadZip);
router.delete('/:id', checkLoginStatus, checkReader, requestController.deleteRequest);


// Document Routes
router.get('/:id/pdf', checkLoginStatus, documentController.convertToPDF);
router.post(
  '/:id/documents',
  checkLoginStatus,
  checkReader,
  requestUpload.array('documents', 100),
  documentController.uploadDocuments
);
router.get('/:id/documents/:documentId/preview', checkLoginStatus, documentController.previewDocument);
router.delete('/:id/documents/:documentId', checkLoginStatus, checkReader, documentController.deleteDocument);

// Signature Routes
router.get('/documents/:documentId',checkLoginStatus, signatureController.getDocumentData);
router.post('/:id/send', checkLoginStatus, checkReader, signatureController.sendForSignature);
router.post('/:id/sign', checkLoginStatus, signatureController.signRequest);
router.post('/:id/reject', checkLoginStatus, checkOfficer, signatureController.rejectRequest);
router.post('/:id/documents/:documentId/reject', checkLoginStatus, checkOfficer, signatureController.rejectDocument);
router.post('/:id/delegate', checkLoginStatus, checkOfficer, signatureController.delegateRequest);

export default router;