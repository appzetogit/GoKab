import { Router } from 'express';
import { chatModuleRouter } from '../chat/routes/index.js';
import { adminModuleRouter } from '../admin/routes/index.js';
import { driverModuleRouter } from '../driver/routes/index.js';
import { supportModuleRouter } from '../support/routes/index.js';
import { userModuleRouter } from '../user/routes/index.js';
import { commonRouter } from '../common/routes/commonRoutes.js';
import { userAdvertisementRouter } from '../user/routes/advertisementRoutes.js';
import { asyncHandler } from '../../../utils/asyncHandler.js';
import { Vehicle } from '../admin/models/Vehicle.js';
import { DriverPreference } from '../admin/models/DriverPreference.js';
import { AppLanguage } from '../admin/models/AppLanguage.js';

export const taxiRouter = Router();

taxiRouter.use(chatModuleRouter);
taxiRouter.use(adminModuleRouter);
taxiRouter.use(userModuleRouter);
taxiRouter.use(driverModuleRouter);
taxiRouter.use(supportModuleRouter);
taxiRouter.use(commonRouter);
taxiRouter.use('/advertisements', userAdvertisementRouter);

// Endpoint to fetch active vehicle types
taxiRouter.get('/vehicle-types/active', asyncHandler(async (req, res) => {
  const list = await Vehicle.find({ active: true, status: 1 }).lean();
  const filtered = list.filter(v => v.image);
  
  const mapped = filtered.map(v => {
    let category = 'SEDAN';
    const nameLower = v.name.toLowerCase();
    if (nameLower.includes('auto')) category = 'AUTO';
    else if (nameLower.includes('suv')) category = 'SUV';
    else if (nameLower.includes('mini') || nameLower.includes('hatchback')) category = 'HATCHBACK';
    else if (nameLower.includes('xl')) category = 'XL';
    else if (nameLower.includes('premium')) category = 'PREMIUM';

    return {
      _id: v._id,
      name: v.name,
      image: v.image,
      capacity: v.capacity,
      category,
    };
  });

  res.json(mapped);
}));

// Endpoint to fetch preferences (languages and driver preferences)
taxiRouter.get('/preferences', asyncHandler(async (req, res) => {
  let dbPrefs = await DriverPreference.find({ active: true }).lean();
  if (dbPrefs.length === 0) {
    const defaultPrefs = [
      { name: 'Pet Friendly', key: 'PET_FRIENDLY', icon: '', active: true },
      { name: 'Experienced', key: 'EXPERIENCED', icon: '', active: true },
      { name: 'Married', key: 'MARRIED', icon: '', active: true },
      { name: 'Part Time Driver', key: 'PART_TIME', icon: '', active: true },
      { name: 'Full Time Driver', key: 'FULL_TIME', icon: '', active: true },
      { name: 'Personal Car', key: 'PERSONAL_CAR', icon: '', active: true },
      { name: 'Event/Wedding Driver', key: 'EVENT_WEDDING', icon: '', active: true },
      { name: 'Wheelchair Friendly', key: 'WHEELCHAIR', icon: '', active: true },
      { name: 'Strong Network', key: 'STRONG_NETWORK', icon: '', active: true },
      { name: 'Most Active', key: 'MOST_ACTIVE', icon: '', active: true }
    ];
    await DriverPreference.create(defaultPrefs);
    dbPrefs = await DriverPreference.find({ active: true }).lean();
  }

  let dbLanguages = await AppLanguage.find({ active: 1 }).lean();
  if (dbLanguages.length === 0) {
    const defaultLanguages = [
      { name: 'English', code: 'en', active: 1 },
      { name: 'Hindi', code: 'hi', active: 1 },
      { name: 'Punjabi', code: 'pa', active: 1 },
      { name: 'Gujarati', code: 'gu', active: 1 }
    ];
    await AppLanguage.create(defaultLanguages);
    dbLanguages = await AppLanguage.find({ active: 1 }).lean();
  }

  res.json({
    success: true,
    languages: dbLanguages.map(l => l.name),
    driverPreferences: dbPrefs.map(p => ({
      name: p.name,
      key: p.key,
      icon: p.icon || '',
      active: p.active
    }))
  });
}));
