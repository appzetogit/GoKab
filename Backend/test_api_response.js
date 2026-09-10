import mongoose from 'mongoose';
import dotenv from 'dotenv';

dotenv.config();

const poolingRouteSchema = new mongoose.Schema({
  routeName: String,
  assignedVehicleTypeIds: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'TaxiPoolingVehicle'
  }]
}, { strict: false });

const poolingVehicleSchema = new mongoose.Schema({
  name: String,
  vehicleModel: String,
  vehicleNumber: String,
  serviceTaxPercentage: Number
}, { strict: false });

async function main() {
  await mongoose.connect(process.env.MONGODB_URI, { dbName: process.env.MONGODB_DB_NAME || 'Cluster0' });

  // Register models
  const PoolingRoute = mongoose.models.TaxiPoolingRoute || mongoose.model('TaxiPoolingRoute', poolingRouteSchema, 'taxipoolingroutes');
  const PoolingVehicle = mongoose.models.TaxiPoolingVehicle || mongoose.model('TaxiPoolingVehicle', poolingVehicleSchema, 'taxipoolingvehicles');

  const route = await PoolingRoute.findOne({ routeName: 'Indore to Bhopal' }).populate('assignedVehicleTypeIds');
  
  if (!route) {
    console.error('Route not found');
    process.exit(1);
  }

  const responseData = {
    ...route.toObject(),
    seatAvailability: {}
  };

  console.log('--- ROUTE DETAILS API RESPONSE ---');
  console.log(JSON.stringify(responseData, null, 2));

  process.exit(0);
}

main().catch(console.error);
