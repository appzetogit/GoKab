import dotenv from 'dotenv';
import mongoose from 'mongoose';
import { getFirebaseMessaging } from '../src/config/firebase.js';
import { User } from '../src/modules/taxi/user/models/User.js';
import { Driver } from '../src/modules/taxi/driver/models/Driver.js';
import { sendPushNotificationToEntities } from '../src/modules/taxi/services/pushNotificationService.js';

dotenv.config();

const phone = String(process.argv[2] || '').replace(/\D/g, '').slice(-10);

if (!phone) {
  console.error('Usage: node scratch/sendTestPushToPhone.js <10-digit-phone>');
  process.exit(1);
}

const summarizeEntity = (label, entity) => ({
  role: label,
  id: String(entity?._id || ''),
  phone: entity?.phone || '',
  fcmTokenWeb: String(entity?.fcmTokenWeb || '').trim(),
  fcmTokenMobile: String(entity?.fcmTokenMobile || '').trim(),
});

const collectTargets = (entity, role) =>
  [
    { role, field: 'fcmTokenWeb', token: String(entity?.fcmTokenWeb || '').trim() },
    { role, field: 'fcmTokenMobile', token: String(entity?.fcmTokenMobile || '').trim() },
  ].filter((item) => item.token);

const main = async () => {
  await mongoose.connect(process.env.MONGODB_URI, {
    dbName: process.env.MONGODB_DB_NAME || 'appzeto_taxi',
  });

  const [user, driver] = await Promise.all([
    User.findOne({ phone }).select('_id phone fcmTokenWeb fcmTokenMobile').lean(),
    Driver.findOne({ phone }).select('_id phone fcmTokenWeb fcmTokenMobile').lean(),
  ]);

  console.log('Lookup result:');
  console.log(JSON.stringify({
    user: user ? summarizeEntity('user', user) : null,
    driver: driver ? summarizeEntity('driver', driver) : null,
  }, null, 2));

  const rawTargets = [
    ...(user ? collectTargets(user, 'user') : []),
    ...(driver ? collectTargets(driver, 'driver') : []),
  ];
  const dedupedTargets = Array.from(new Map(rawTargets.map((item) => [item.token, item])).values());

  console.log('Resolved token targets:');
  console.log(JSON.stringify(
    dedupedTargets.map((item) => ({
      role: item.role,
      field: item.field,
      tokenPreview: `${item.token.slice(0, 18)}...${item.token.slice(-10)}`,
    })),
    null,
    2,
  ));

  const userIds = user?._id ? [user._id] : [];
  const driverIds = driver?._id ? [driver._id] : [];

  if (userIds.length === 0 && driverIds.length === 0) {
    console.log('No matching user or driver found for that phone number.');
    return;
  }

  const result = await sendPushNotificationToEntities({
    userIds,
    driverIds,
    title: 'Test Push',
    body: `Push test for ${phone} at ${new Date().toISOString()}`,
    data: {
      type: 'manual_test_push',
      phone,
      sentAt: new Date().toISOString(),
    },
  });

  console.log('Push send result:');
  console.log(JSON.stringify(result, null, 2));

  const messaging = getFirebaseMessaging();
  if (messaging && dedupedTargets.length > 0) {
    const directResponse = await messaging.sendEachForMulticast({
      tokens: dedupedTargets.map((item) => item.token),
      notification: {
        title: 'Direct Push Debug',
        body: `Debug push for ${phone} at ${new Date().toISOString()}`,
      },
      data: {
        type: 'direct_debug_push',
        phone,
      },
      android: {
        priority: 'high',
      },
      webpush: {
        notification: {
          title: 'Direct Push Debug',
          body: `Debug push for ${phone}`,
        },
      },
    });

    console.log('Per-token delivery result:');
    console.log(JSON.stringify(
      directResponse.responses.map((item, index) => ({
        role: dedupedTargets[index].role,
        field: dedupedTargets[index].field,
        tokenPreview: `${dedupedTargets[index].token.slice(0, 18)}...${dedupedTargets[index].token.slice(-10)}`,
        success: item.success,
        errorCode: item.error?.code || '',
        errorMessage: item.error?.message || '',
      })),
      null,
      2,
    ));
  }
};

main()
  .catch((error) => {
    console.error('Failed to send test push:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect().catch(() => {});
  });
