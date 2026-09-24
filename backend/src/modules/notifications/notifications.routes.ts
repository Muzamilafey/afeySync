import { Router } from 'express';
import { isValidObjectId } from 'mongoose';
import { h } from '../../utils/asyncHandler';
import { authenticateTenant } from '../../middleware/auth';
import { notFound } from '../../utils/errors';

const router = Router();
router.use(authenticateTenant);

router.get(
  '/',
  h(async (req, res) => {
    const { Notification } = req.tenant!.models;
    const [items, unread] = await Promise.all([
      Notification.find({ userId: req.user!.id }).sort({ createdAt: -1 }).limit(50).lean(),
      Notification.countDocuments({ userId: req.user!.id, readAt: null }),
    ]);
    res.json({ success: true, data: items, meta: { unread } });
  }),
);

router.post(
  '/:id/read',
  h(async (req, res) => {
    if (!isValidObjectId(req.params.id)) throw notFound();
    const r = await req.tenant!.models.Notification.updateOne({ _id: req.params.id, userId: req.user!.id }, { readAt: new Date() });
    if (!r.matchedCount) throw notFound();
    res.json({ success: true });
  }),
);

router.post(
  '/read-all',
  h(async (req, res) => {
    await req.tenant!.models.Notification.updateMany({ userId: req.user!.id, readAt: null }, { readAt: new Date() });
    res.json({ success: true });
  }),
);

export default router;
