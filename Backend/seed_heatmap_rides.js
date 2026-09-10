import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { Ride } from './src/modules/taxi/user/models/Ride.js';
import { RIDE_STATUS, RIDE_LIVE_STATUS } from './src/modules/taxi/constants/index.js';

dotenv.config();

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017';
const dbName = process.env.MONGODB_DB_NAME || 'gokab';

const SAMPLE_BOOKING_LOCATIONS = [
  // INDORE
  { city: 'Indore', address: 'Vijay Nagar, Indore, Madhya Pradesh', coords: [75.8937, 22.7533] },
  { city: 'Indore', address: 'Palasia Square, Indore, MP', coords: [75.8824, 22.7244] },
  { city: 'Indore', address: 'Indore Railway Station, MP', coords: [75.8672, 22.7196] },
  { city: 'Indore', address: 'Rajwada Palace, Indore, MP', coords: [75.8577, 22.7196] },
  { city: 'Indore', address: 'Bhawarkua Square, Indore, MP', coords: [75.8647, 22.6916] },
  
  // MUMBAI
  { city: 'Mumbai', address: 'Bandra Kurla Complex, Mumbai, Maharashtra', coords: [72.8679, 19.0657] },
  { city: 'Mumbai', address: 'Chhatrapati Shivaji Maharaj Airport T2, Mumbai', coords: [72.8744, 19.0974] },
  { city: 'Mumbai', address: 'Andheri West, Mumbai, MH', coords: [72.8362, 19.1197] },
  { city: 'Mumbai', address: 'Nariman Point, South Mumbai, MH', coords: [72.8236, 18.9256] },

  // DELHI NCR
  { city: 'Delhi NCR', address: 'Connaught Place, New Delhi', coords: [77.2167, 28.6315] },
  { city: 'Delhi NCR', address: 'Cyber City, Gurugram, Haryana', coords: [77.0882, 28.4950] },
  { city: 'Delhi NCR', address: 'Sector 62, Noida, Uttar Pradesh', coords: [77.3639, 28.6280] },
  { city: 'Delhi NCR', address: 'IGI Airport Terminal 3, New Delhi', coords: [77.0844, 28.5562] },

  // BENGALURU
  { city: 'Bengaluru', address: 'Indiranagar 100ft Road, Bengaluru, Karnataka', coords: [77.6412, 12.9784] },
  { city: 'Bengaluru', address: 'Whitefield IT Park, Bengaluru, KA', coords: [77.7499, 12.9698] },
  { city: 'Bengaluru', address: 'Koramangala 5th Block, Bengaluru, KA', coords: [77.6245, 12.9352] },
  { city: 'Bengaluru', address: 'Kempegowda International Airport, Bengaluru', coords: [77.7066, 13.1986] },
];

async function seedHeatmapBookings() {
  try {
    console.log(`Connecting to MongoDB database: ${dbName}...`);
    await mongoose.connect(MONGODB_URI, { dbName });
    console.log('Connected successfully!');

    let seededCount = 0;
    const dummyUserId = new mongoose.Types.ObjectId();

    for (const loc of SAMPLE_BOOKING_LOCATIONS) {
      for (let i = 0; i < 3; i++) {
        const jitterLng = loc.coords[0] + (Math.random() - 0.5) * 0.015;
        const jitterLat = loc.coords[1] + (Math.random() - 0.5) * 0.015;

        await Ride.create({
          userId: dummyUserId,
          pickupAddress: loc.address,
          pickupLocation: {
            type: 'Point',
            coordinates: [jitterLng, jitterLat],
          },
          dropAddress: `${loc.city} Center Drop`,
          dropLocation: {
            type: 'Point',
            coordinates: [jitterLng + 0.02, jitterLat + 0.02],
          },
          status: i === 0 ? RIDE_STATUS.SEARCHING : i === 1 ? RIDE_STATUS.ACCEPTED : RIDE_STATUS.COMPLETED,
          liveStatus: i === 0 ? RIDE_LIVE_STATUS.SEARCHING : RIDE_LIVE_STATUS.COMPLETED,
          vehicleType: 'Car',
          fare: 150 + i * 50,
          totalAmount: 150 + i * 50,
          paymentMethod: 'CASH',
        });
        seededCount += 1;
      }
    }

    console.log(`Successfully seeded ${seededCount} real dynamic heatmap ride bookings!`);
    process.exit(0);
  } catch (err) {
    console.error('Error seeding heatmap bookings:', err);
    process.exit(1);
  }
}

seedHeatmapBookings();
