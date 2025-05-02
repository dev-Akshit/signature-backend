import { Router } from 'express';
import { signatureServices } from '../../services/index.js';
import { checkLoginStatus } from '../../middleware/checkAuth.js';
import { signatureUpload } from '../../middleware/multer.js';
import path from 'path';

const router = Router();

router.post(
    '/',
    checkLoginStatus,
    signatureUpload.single('signatureFile'),
    async (req, res, next) => {
        try {
            const userId = req.session.userId;
            if (!userId) {
                return res.status(403).json({ error: 'User not assigned' });
            }
            const signatureFile = req.file;
            if (!signatureFile) {
                return res.status(400).json({ error: 'Signature file is required' });
            }

            const relativePath = path.join('/uploads/signatures', path.basename(signatureFile.path));

            const signature = await signatureServices.save({
                userId,
                url: relativePath,
                createdBy: userId,
                updatedBy: userId,
            });
            // console.log('signature', signature);

            return res.json({
                id: signature._id.toString(),
                userId: signature.userId.toString(),
                url: signature.url,
                createdBy: signature.createdBy,
                updatedBy: signature.updatedBy,
            });
        } catch (error) {
            console.error('POST /api/signatures error:', error);
            next(error);
        }
    }
);

router.get('/', checkLoginStatus, async (req, res, next) => {
    try {
        const userId = req.session.userId;
        if (!userId) {
            return res.status(403).json({ error: 'User not assigned' });
        }

        const signatures = await signatureServices.findAllByUser(userId);
        // console.log('signatures', signatures);
        return res.json(signatures);
    } catch (error) {
        console.error('GET /api/signatures error:', error);
        next(error);
    }
});

router.get('/image/:id', checkLoginStatus, async (req, res, next) => {
    try {
        const { id } = req.params;
        const userId = req.session.userId;
        if (!userId) {
            return res.status(403).json({ error: 'User not assigned' });
        }
        const signature = await signatureServices.findOne({_id: id});
        if (!signature) {
            return res.status(404).json({ error: 'Signature not found' });
        }
        const filePath = signature.url;
        const ext = path.extname(filePath);
        const contentType = {
            '.png': 'image/png',
            '.jpg': 'image/jpeg',
            '.jpeg': 'image/jpeg',
        }[ext] || 'application/octet-stream';

        res.setHeader('Content-Type', contentType);
        res.setHeader('Content-Disposition', 'inline');
        fs.createReadStream(filePath).pipe(res);
    } catch (error) {
        console.error('GET /api/signatures/image/:id error:', error);
        next(error);
    }
});

export default router;