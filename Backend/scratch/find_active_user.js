import mongoose from 'mongoose';
import dotenv from 'dotenv';

dotenv.config();

const check = async () => {
    const dbName = process.env.MONGODB_DB_NAME || 'appzeto_taxi';
    await mongoose.connect(process.env.MONGODB_URI, {
        dbName: dbName
    });
    
    console.log('Connected to DB:', dbName);
    
    // Find all users
    const users = await mongoose.connection.db.collection('taxiusers').find({}).toArray();
    console.log('Total users:', users.length);
    for (const u of users) {
        console.log(`User ID: ${u._id}, Name: ${u.name}, Phone: ${u.phone}`);
    }
    
    // Find sessions in taxiuserauthsessions
    const sessions = await mongoose.connection.db.collection('taxiuserauthsessions').find({}).toArray();
    console.log('Total sessions:', sessions.length);
    for (const s of sessions) {
        console.log(`Session ID: ${s._id}, UserID: ${s.userId}, token: ${s.token ? s.token.substring(0, 20) + '...' : 'none'}, expires: ${s.expiresAt || s.expires}`);
    }
    
    process.exit(0);
};
check();
