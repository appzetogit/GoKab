
import mongoose from 'mongoose';

const mongoUrl = 'mongodb+srv://mrindianarmy100_db_user:h0qizv8eJVwnUHGC@taxi.6ifoxfu.mongodb.net/appzeto_taxi?appName=Taxi';

// Schemas copied for standalone script
const slSchema = new mongoose.Schema({ name: String, currency_symbol: String, active: Number }, { strict: false });
const zoneSchema = new mongoose.Schema({ name: String, service_location_id: mongoose.Schema.Types.ObjectId, unit: String, active: Number }, { strict: false });
const vehicleSchema = new mongoose.Schema({ name: String, icon: String, capacity: Number, active: Number }, { strict: false });
const priceSchema = new mongoose.Schema({ zone_id: mongoose.Schema.Types.ObjectId, vehicle_type: mongoose.Schema.Types.ObjectId, transport_type: String, active: Number }, { strict: false });

const ServiceLocation = mongoose.model('TaxiServiceLocation', slSchema);
const Zone = mongoose.model('TaxiZone', zoneSchema);
const Vehicle = mongoose.model('TaxiVehicle', vehicleSchema);
const SetPrice = mongoose.model('TaxiSetPrice', priceSchema);

async function seed() {
    try {
        await mongoose.connect(mongoUrl);
        console.log('Connected to DB');

        // 1. Find or create Service Location India
        let sl = await ServiceLocation.findOne({ name: 'India' });
        if (!sl) {
            sl = await ServiceLocation.create({ name: 'India', currency_symbol: '₹', active: 1 });
            console.log('Created Service Location India');
        }

        // 2. Find or create Zone India
        let zone = await Zone.findOne({ name: 'India' });
        if (!zone) {
            zone = await Zone.create({ 
                name: 'India', 
                service_location_id: sl._id, 
                unit: '1', 
                active: 1,
                geometry: { type: 'Polygon', coordinates: [[[0,0], [0,1], [1,1], [0,0]]] } // Dummy geometry
            });
            console.log('Created Zone India');
        }

        // 3. Clear existing prices for this zone
        await SetPrice.deleteMany({ zone_id: zone._id });
        console.log('Cleared existing prices for Zone India');

        // 4. Get Vehicles
        const vehicles = await Vehicle.find({});
        console.log(`Found ${vehicles.length} vehicles`);

        // 5. Create prices
        const priceEntries = vehicles.map(v => {
            let config = {
                zone_id: zone._id,
                vehicle_type: v._id,
                transport_type: v.transport_type || 'both',
                active: 1,
                admin_commision_type: 1,
                admin_commision: 10,
                service_tax: 18,
                payment_type: ['cash', 'online', 'wallet']
            };

            // Customizations based on user names
            if (v.name === 'Bike') {
                config.admin_commision = 10;
                config.service_tax = 3;
            } else if (v.name === 'E-Rickshaw') {
                config.service_tax = 12;
            }

            return config;
        });

        await SetPrice.insertMany(priceEntries);
        console.log(`Seeded ${priceEntries.length} price entries`);

        await mongoose.disconnect();
        console.log('Done');
    } catch (err) {
        console.error(err);
        process.exit(1);
    }
}

seed();
