import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { Ride } from '../src/modules/taxi/user/models/Ride.js';

dotenv.config();

const check = async () => {
    const dbName = process.env.MONGODB_DB_NAME || 'appzeto_taxi';
    await mongoose.connect(process.env.MONGODB_URI, {
        dbName: dbName
    });
    
    console.log('Connected to DB:', dbName);
    
    const userId = "69fc5fad3f4fa695b64b47df";
    
    const activeRides = await Ride.find({
        userId: new mongoose.Types.ObjectId(userId),
        status: { $in: ['searching', 'accepted', 'ongoing'] }
    }).lean();
    
    console.log('Active Rides in DB:', activeRides);
    
    process.exit(0);
};
check();
