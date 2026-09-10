import mongoose from 'mongoose';
import dotenv from 'dotenv';

dotenv.config();

const check = async () => {
    // Specify the dbName explicitly
    const dbName = process.env.MONGODB_DB_NAME || 'appzeto_taxi';
    await mongoose.connect(process.env.MONGODB_URI, {
        dbName: dbName
    });
    
    console.log('Connected to DB:', dbName);
    
    // Get all collections in appzeto_taxi
    const collections = await mongoose.connection.db.listCollections().toArray();
    console.log('Collections in appzeto_taxi:', collections.map(c => c.name));
    
    try {
        const bookings = await mongoose.connection.db.collection('taxirentalbookingrequests').find({}).toArray();
        console.log('All Rental Booking Requests:', JSON.stringify(bookings.map(b => ({
            id: b._id,
            bookingReference: b.bookingReference,
            status: b.status,
            userId: b.userId,
            vehicleName: b.vehicleName,
            createdAt: b.createdAt,
            updatedAt: b.updatedAt
        })), null, 2));
    } catch (e) {
        console.log('Error fetching taxirentalbookingrequests:', e.message);
    }
    
    try {
        const users = await mongoose.connection.db.collection('users').find({}).toArray();
        console.log('All Users:', users.map(u => ({ id: u._id, name: u.name, phone: u.phone, email: u.email })));
    } catch (e) {
        console.log('Error fetching users:', e.message);
    }
    
    process.exit(0);
};
check();
