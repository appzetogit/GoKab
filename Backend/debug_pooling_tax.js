import mongoose from 'mongoose';
import dotenv from 'dotenv';

dotenv.config();

const poolingRouteSchema = new mongoose.Schema({
  routeName: String,
  assignedVehicleTypeIds: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'TaxiPoolingVehicle'
  }]
});

const poolingVehicleSchema = new mongoose.Schema({
  name: String,
  vehicleModel: String,
  vehicleNumber: String,
  serviceTaxPercentage: Number
});

async function main() {
  await mongoose.connect(process.env.MONGODB_URI, { dbName: process.env.MONGODB_DB_NAME || 'Cluster0' });

  // Register models
  const PoolingRoute = mongoose.models.TaxiPoolingRoute || mongoose.model('TaxiPoolingRoute', poolingRouteSchema, 'taxipoolingroutes');
  const PoolingVehicle = mongoose.models.TaxiPoolingVehicle || mongoose.model('TaxiPoolingVehicle', poolingVehicleSchema, 'taxipoolingvehicles');

  const route = await PoolingRoute.findOne({}).populate('assignedVehicleTypeIds');
  console.log('Populated Route:', JSON.stringify(route, null, 2));

  process.exit(0);
}

main().catch(console.error);
