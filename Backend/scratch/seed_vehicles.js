import mongoose from 'mongoose';

const mongoUrl = 'mongodb+srv://mrindianarmy100_db_user:h0qizv8eJVwnUHGC@taxi.6ifoxfu.mongodb.net/appzeto_taxi?appName=Taxi';

const vehicleSchema = new mongoose.Schema({
    name: String,
    short_description: String,
    description: String,
    transport_type: { type: String, enum: ['taxi', 'delivery'] },
    dispatch_type: String,
    icon_types: String,
    image: String,
    icon: String,
    capacity: Number,
    size: String,
    is_taxi: String,
    is_accept_share_ride: Number,
    active: Boolean,
    status: Number,
}, { timestamps: true, strict: false });

const TaxiVehicle = mongoose.model('TaxiVehicle', vehicleSchema);

const seedData = [
    {
        name: "Parcel",
        icon: "https://admin.genzoride.com/storage/uploads/types/images/gJ6bMysTHUFcama3tTF8dB49rciZPMQj0cHwSBQP.png",
        icon_types: "motor_bike",
        dispatch_type: "normal",
        capacity: 12,
        size: "2",
        description: "Parcel Delivery",
        short_description: "Normal Delivery",
        is_accept_share_ride: 0,
        active: true,
        status: 1,
        is_taxi: "both",
        transport_type: "delivery"
    },
    {
        name: "Taxi",
        icon: "https://admin.genzoride.com/storage/uploads/types/images/k3XjbRakghBAkSJVMdmL2rDcXYzwYaGa4oHtnnLm.png",
        icon_types: "car",
        dispatch_type: "normal",
        capacity: 35,
        size: null,
        description: "Normal Taxi",
        short_description: "Normal Taxi",
        is_accept_share_ride: 0,
        active: true,
        status: 1,
        is_taxi: "taxi",
        transport_type: "taxi"
    },
    {
        name: "E-Rickshaw",
        icon: "https://admin.genzoride.com/storage/uploads/types/images/2mvOfmCLKkgZvps7YnNjLY0FBRXycJ4kPzBqsVCH.png",
        icon_types: "auto",
        dispatch_type: "normal",
        capacity: 34,
        size: null,
        description: "E-Rickshaw",
        short_description: "Normal Taxi",
        is_accept_share_ride: 0,
        active: true,
        status: 1,
        is_taxi: "taxi",
        transport_type: "taxi"
    },
    {
        name: "Auto",
        icon: "https://admin.genzoride.com/storage/uploads/types/images/6R3UBxQfQYOmtW6jLvVKAaLB368TVoeJqxTjyLdV.png",
        icon_types: "auto",
        dispatch_type: "normal",
        capacity: 23,
        size: null,
        description: "Auto Taxi",
        short_description: "Normal Taxi",
        is_accept_share_ride: 0,
        active: true,
        status: 1,
        is_taxi: "taxi",
        transport_type: "taxi"
    },
    {
        name: "Bike",
        icon: "https://admin.genzoride.com/storage/uploads/types/images/mN32tL5rwTixpyX63jHdOfHBSFH6GU1ZLojeCBj9.png",
        icon_types: "motor_bike",
        dispatch_type: "both",
        capacity: 1,
        size: null,
        description: "Bike Taxi",
        short_description: "Two Wheeler",
        is_accept_share_ride: 0,
        active: true,
        status: 1,
        is_taxi: "both",
        transport_type: "taxi"
    }
];

mongoose.connect(mongoUrl).then(async () => {
    console.log('Cleaning existing vehicles...');
    await TaxiVehicle.deleteMany({});
    console.log('Seeding new vehicles...');
    await TaxiVehicle.insertMany(seedData);
    console.log('Seeding complete');
    process.exit(0);
}).catch(err => {
    console.error(err);
    process.exit(1);
});
