import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { RentalVehicleType } from '../src/modules/taxi/admin/models/RentalVehicleType.js';

dotenv.config();

const run = async () => {
    const dbName = process.env.MONGODB_DB_NAME || 'appzeto_taxi';
    await mongoose.connect(process.env.MONGODB_URI, {
        dbName: dbName
    });
    
    console.log('Connected to DB:', dbName);
    
    const vehicles = await RentalVehicleType.find({}).lean();
    console.log('--- RENTAL VEHICLES ---');
    console.log(JSON.stringify(vehicles.map(v => ({
        id: v._id,
        name: v.name,
        vehicleCategory: v.vehicleCategory,
        capacity: v.capacity,
        active: v.active
    })), null, 2));
    
    process.exit(0);
};

run().catch(err => {
    console.error(err);
    process.exit(1);
});
