import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { Ride } from '../src/modules/taxi/user/models/Ride.js';

dotenv.config();

const cleanup = async () => {
    const dbName = process.env.MONGODB_DB_NAME || 'appzeto_taxi';
    await mongoose.connect(process.env.MONGODB_URI, {
        dbName: dbName
    });
    
    console.log('Connected to DB:', dbName);
    
    const userId = "69fc5fad3f4fa695b64b47df";
    
    // Complete or cancel any stale taxi/parcel rides for this user
    const result = await Ride.updateMany(
        {
            userId: new mongoose.Types.ObjectId(userId),
            status: { $in: ['searching', 'accepted', 'ongoing', 'started', 'arriving', 'arrived'] }
        },
        {
            $set: {
                status: 'completed',
                liveStatus: 'completed',
                completedAt: new Date()
            }
        }
    );
    
    console.log('Stale rides cleanup result:', result);
    
    process.exit(0);
};
cleanup();
