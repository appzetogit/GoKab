
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: 'c:/Users/SHUBHAM/Desktop/Appzeto-Taxi/Backend/.env' });

const mongoUri = process.env.MONGODB_URI;
const dbName = process.env.MONGODB_DB_NAME || 'Redigo';

const goodsTypesData = [
    {
        "id": 10,
        "goods_type_name": "Paper/Packaging/Printed Material",
        "translation_dataset": "{\"en\":{\"locale\":\"en\",\"name\":\"Paper\\/Packaging\\/Printed Material\"}}",
        "goods_types_for": "both",
        "company_key": null,
        "active": 1,
        "goods_type_translation_words": [
            { "id": 10, "goods_type_id": 10, "name": "Paper/Packaging/Printed Material", "locale": "en", "created_at": null, "updated_at": null }
        ]
    },
    {
        "id": 18,
        "goods_type_name": "Books/Stationery/Toys/Gifts",
        "translation_dataset": "{\"en\":{\"locale\":\"en\",\"name\":\"Books\\\/Stationery\\\/Toys\\\/Gifts\"}}",
        "goods_types_for": "both",
        "company_key": null,
        "active": 1,
        "goods_type_translation_words": [
            { "id": 18, "goods_type_id": 18, "name": "Books/Stationery/Toys/Gifts", "locale": "en", "created_at": null, "updated_at": null }
        ]
    },
    {
        "id": 17,
        "goods_type_name": "Plastic/Rubber",
        "translation_dataset": "{\"en\":{\"locale\":\"en\",\"name\":\"Plastic\\\/Rubber\"}}",
        "goods_types_for": "both",
        "company_key": null,
        "active": 1,
        "goods_type_translation_words": [
            { "id": 17, "goods_type_id": 17, "name": "Plastic/Rubber", "locale": "en", "created_at": null, "updated_at": null }
        ]
    },
    {
        "id": 16,
        "goods_type_name": "Jewelry/Watches",
        "translation_dataset": "{\"en\":{\"locale\":\"en\",\"name\":\"Jewelry\\\/Watches\"}}",
        "goods_types_for": "both",
        "company_key": null,
        "active": 1,
        "goods_type_translation_words": [
            { "id": 16, "goods_type_id": 16, "name": "Jewelry/Watches", "locale": "en", "created_at": null, "updated_at": null }
        ]
    },
    {
        "id": 15,
        "goods_type_name": "FMCG/Food Products",
        "translation_dataset": "{\"en\":{\"locale\":\"en\",\"name\":\"FMCG\\\/Food Products\"}}",
        "goods_types_for": "both",
        "company_key": null,
        "active": 1,
        "goods_type_translation_words": [
            { "id": 15, "goods_type_id": 15, "name": "FMCG/Food Products", "locale": "en", "created_at": null, "updated_at": null }
        ]
    },
    {
        "id": 14,
        "goods_type_name": "Pharmacy/Medical?Healthcare/Fitness Equipment",
        "translation_dataset": "{\"en\":{\"locale\":\"en\",\"name\":\"Pharmacy\\\/Medical?Healthcare\\\/Fitness Equipment\"}}",
        "goods_types_for": "both",
        "company_key": null,
        "active": 1,
        "goods_type_translation_words": [
            { "id": 14, "goods_type_id": 14, "name": "Pharmacy/Medical?Healthcare/Fitness Equipment", "locale": "en", "created_at": null, "updated_at": null }
        ]
    },
    {
        "id": 13,
        "goods_type_name": "Perishable Food Items",
        "translation_dataset": "{\"en\":{\"locale\":\"en\",\"name\":\"Perishable Food Items\"}}",
        "goods_types_for": "both",
        "company_key": null,
        "active": 1,
        "goods_type_translation_words": [
            { "id": 13, "goods_type_id": 13, "name": "Perishable Food Items", "locale": "en", "created_at": null, "updated_at": null }
        ]
    },
    {
        "id": 12,
        "goods_type_name": "Logistics service provider/Packers and Movers",
        "translation_dataset": "{\"en\":{\"locale\":\"en\",\"name\":\"Logistics service provider\\\/Packers and Movers\"}}",
        "goods_types_for": "both",
        "company_key": null,
        "active": 1,
        "goods_type_translation_words": [
            { "id": 12, "goods_type_id": 12, "name": "Logistics service provider/Packers and Movers", "locale": "en", "created_at": null, "updated_at": null }
        ]
    },
    {
        "id": 11,
        "goods_type_name": "Chemicals/Paints",
        "translation_dataset": "{\"en\":{\"locale\":\"en\",\"name\":\"Chemicals\\\/Paints\"}}",
        "goods_types_for": "both",
        "company_key": null,
        "active": 1,
        "goods_type_translation_words": [
            { "id": 11, "goods_type_id": 11, "name": "Chemicals/Paints", "locale": "en", "created_at": null, "updated_at": null }
        ]
    },
    {
        "id": 1,
        "goods_type_name": "Timber/Plywood/Laminate",
        "translation_dataset": "{\"en\":{\"locale\":\"en\",\"name\":\"Timber\\\/Plywood\\\/Laminate\"}}",
        "goods_types_for": "both",
        "company_key": null,
        "active": 1,
        "goods_type_translation_words": [
            { "id": 1, "goods_type_id": 1, "name": "Timber/Plywood/Laminate", "locale": "en", "created_at": null, "updated_at": null }
        ]
    }
];

const goodsSchema = new mongoose.Schema({
    goods_type_name: String,
    translation_dataset: String,
    goods_types_for: String,
    company_key: String,
    active: Number,
    goods_type_translation_words: [mongoose.Schema.Types.Mixed],
    external_id: Number
}, { collection: 'taxigoodstypes', timestamps: true });

const Goods = mongoose.models.TaxiGoodsType || mongoose.model('TaxiGoodsType', goodsSchema);

async function seed() {
    try {
        await mongoose.connect(mongoUri, { dbName });
        console.log("Connected to MongoDB.");

        await Goods.deleteMany({});
        console.log("Old GoodsTypes cleared.");

        const toInsert = goodsTypesData.map(item => ({
            ...item,
            external_id: item.id,
            id: undefined // Remove original so mongo creates _id
        }));

        await Goods.insertMany(toInsert);
        console.log(`Inserted ${toInsert.length} GoodsTypes.`);

        process.exit(0);
    } catch (err) {
        console.error("Error seeding:", err);
        process.exit(1);
    }
}

seed();
