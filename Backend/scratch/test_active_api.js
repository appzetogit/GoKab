import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { RentalVehicleType } from '../src/modules/taxi/admin/models/RentalVehicleType.js';
import { RentalBookingRequest } from '../src/modules/taxi/admin/models/RentalBookingRequest.js';

dotenv.config();

const serializeRentalBookingRequest = (item = {}) => ({
  id: String(item._id || item.id || ''),
  bookingReference: item.bookingReference || '',
  userId: item.userId ? String(item.userId) : '',
  vehicleTypeId: item.vehicleTypeId ? String(item.vehicleTypeId) : '',
  vehicleName: item.vehicleName || '',
  vehicleCategory: item.vehicleCategory || '',
  vehicleImage: item.vehicleImage || '',
  status: item.status || 'pending',
  createdAt: item.createdAt || null,
  updatedAt: item.updatedAt || null,
});

const check = async () => {
    const dbName = process.env.MONGODB_DB_NAME || 'appzeto_taxi';
    await mongoose.connect(process.env.MONGODB_URI, {
        dbName: dbName
    });
    
    console.log('Connected to DB:', dbName);
    
    const userId = "69fc5fad3f4fa695b64b47df";
    
    const item = await RentalBookingRequest.findOne({
      userId: new mongoose.Types.ObjectId(userId),
      status: { $in: ['assigned', 'confirmed', 'end_requested'] },
    })
      .populate('vehicleTypeId', 'pricing')
      .sort({ updatedAt: -1, createdAt: -1 })
      .lean();
      
    console.log('QueryResult:', item);
    if (item) {
        console.log('Serialized:', serializeRentalBookingRequest(item));
    }
    
    process.exit(0);
};
check();
