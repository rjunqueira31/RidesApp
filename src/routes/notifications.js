const express = require('express');

const {
  getNotifications,
  getUnreadNotificationCount,
  markNotificationRead,
  markAllNotificationsRead,
} = require('../store');

const router = express.Router();

router.get('/', async (request, response, next) => {
  try {
    const notifications = await getNotifications(request.currentUser.id);
    response.json({notifications});
  } catch (error) {
    next(error);
  }
});

router.get('/unread-count', async (request, response, next) => {
  try {
    const count = await getUnreadNotificationCount(request.currentUser.id);
    response.json({count});
  } catch (error) {
    next(error);
  }
});

router.post('/:id/read', async (request, response, next) => {
  try {
    await markNotificationRead(request.currentUser.id, request.params.id);
    const count = await getUnreadNotificationCount(request.currentUser.id);
    response.json({success: true, unreadCount: count});
  } catch (error) {
    next(error);
  }
});

router.post('/mark-all-read', async (request, response, next) => {
  try {
    await markAllNotificationsRead(request.currentUser.id);
    response.json({success: true, unreadCount: 0});
  } catch (error) {
    next(error);
  }
});

module.exports = router;
