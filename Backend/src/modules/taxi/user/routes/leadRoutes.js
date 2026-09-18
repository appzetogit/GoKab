import { Router } from 'express';
import { asyncHandler } from '../../../../utils/asyncHandler.js';
import { authenticate } from '../../middlewares/authMiddleware.js';
import {
  listLeadConversations,
  listLeadMessages,
  postLeadMessage,
} from '../../driver/services/leadService.js';

/**
 * The rider's side of a lead conversation: a driver who saw their booking on
 * the feed and reached out before accepting it.
 */
export const userLeadRouter = Router();

const userOnly = authenticate(['user']);

userLeadRouter.get(
  '/',
  userOnly,
  asyncHandler(async (req, res) => {
    res.json({
      success: true,
      data: await listLeadConversations({
        role: 'user',
        entityId: req.auth.sub,
        page: req.query.page,
        limit: req.query.limit,
      }),
    });
  }),
);

userLeadRouter.get(
  '/:conversationId/messages',
  userOnly,
  asyncHandler(async (req, res) => {
    res.json({
      success: true,
      data: await listLeadMessages({
        conversationId: req.params.conversationId,
        role: 'user',
        entityId: req.auth.sub,
        before: req.query.before,
        limit: req.query.limit,
      }),
    });
  }),
);

userLeadRouter.post(
  '/:conversationId/messages',
  userOnly,
  asyncHandler(async (req, res) => {
    res.status(201).json({
      success: true,
      data: await postLeadMessage({
        conversationId: req.params.conversationId,
        role: 'user',
        entityId: req.auth.sub,
        message: req.body?.message,
        clientMessageId: req.body?.clientMessageId,
      }),
    });
  }),
);
