import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { GoogleMap, Circle } from '@react-google-maps/api';
import { 
  ChevronRight, 
  Map as MapIcon, 
  RefreshCw, 
  Eye, 
  Settings2, 
  ArrowLeft,
  Activity,
  Zap,
  Layers,
  Search,
  Filter,
  MapPin,
  X,
  Building2,
  Globe,
  TrendingUp,
  BarChart3,
  Flame
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useAppGoogleMapsLoader, HAS_VALID_GOOGLE_MAPS_KEY } from '../../utils/googleMaps';
import { adminService } from '../../services/adminService';

// ALL INDIA CENTER
const INDIA_CENTER = { lat: 22.5937, lng: 78.9629 };
const MAP_CONTAINER_STYLE = { width: '100%', height: '540px' };

const mapOptions = {
  disableDefaultUI: false,
  zoomControl: true,
  streetViewControl: false,
  mapTypeControl: true,
  fullscreenControl: true,
  styles: [
    { elementType: 'geometry', stylers: [{ color: '#f9fafb' }] },
    { elementType: 'labels.text.fill', stylers: [{ color: '#6b7280' }] },
    { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#ffffff' }] },
    { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#e5e7eb' }] }
  ]
};

// 28 STATES & 8 UNION TERRITORIES (36 TOTAL)
const ALL_INDIA_STATES_DATA = {
  'Andaman & Nicobar Islands': {
    center: { lat: 11.6233, lng: 92.7265 },
    zoom: 9,
    districts: {
      'Port Blair': { lat: 11.6233, lng: 92.7265, zoom: 12 },
      'Havelock Island (Swaraj Dweep)': { lat: 11.9634, lng: 92.9840, zoom: 12 },
      'Diglipur': { lat: 13.2667, lng: 92.9667, zoom: 12 }
    }
  },
  'Andhra Pradesh': {
    center: { lat: 15.9129, lng: 79.7400 },
    zoom: 7,
    districts: {
      'Visakhapatnam': { lat: 17.6868, lng: 83.2185, zoom: 12 },
      'Vijayawada': { lat: 16.5062, lng: 80.6480, zoom: 12 },
      'Guntur': { lat: 16.3067, lng: 80.4365, zoom: 12 },
      'Nellore': { lat: 14.4426, lng: 79.9865, zoom: 12 },
      'Kurnool': { lat: 15.8281, lng: 78.0373, zoom: 12 },
      'Tirupati': { lat: 13.6288, lng: 79.4192, zoom: 12 },
      'Rajamahendravaram': { lat: 17.0005, lng: 81.8040, zoom: 12 },
      'Kakinada': { lat: 16.9891, lng: 82.2475, zoom: 12 },
      'Kadapa': { lat: 14.4673, lng: 78.8242, zoom: 12 },
      'Anantapur': { lat: 14.6819, lng: 77.6006, zoom: 12 },
      'Eluru': { lat: 16.7107, lng: 81.0952, zoom: 12 },
      'Vizianagaram': { lat: 18.1066, lng: 83.3955, zoom: 12 }
    }
  },
  'Arunachal Pradesh': {
    center: { lat: 28.2180, lng: 94.7278 },
    zoom: 7,
    districts: {
      'Itanagar': { lat: 27.0844, lng: 93.6053, zoom: 12 },
      'Naharlagun': { lat: 27.1042, lng: 93.6931, zoom: 12 },
      'Pasighat': { lat: 28.0660, lng: 95.3263, zoom: 12 },
      'Tawang': { lat: 27.5860, lng: 91.8594, zoom: 12 },
      'Ziro': { lat: 27.5947, lng: 93.8383, zoom: 12 },
      'Tezu': { lat: 27.9255, lng: 96.1648, zoom: 12 }
    }
  },
  'Assam': {
    center: { lat: 26.2006, lng: 92.9376 },
    zoom: 7,
    districts: {
      'Guwahati': { lat: 26.1445, lng: 91.7362, zoom: 12 },
      'Silchar': { lat: 24.8333, lng: 92.7789, zoom: 12 },
      'Dibrugarh': { lat: 27.4728, lng: 94.9120, zoom: 12 },
      'Jorhat': { lat: 26.7509, lng: 94.2037, zoom: 12 },
      'Nagaon': { lat: 26.3463, lng: 92.6840, zoom: 12 },
      'Tinsukia': { lat: 27.4922, lng: 95.3538, zoom: 12 },
      'Tezpur': { lat: 26.6528, lng: 92.7926, zoom: 12 },
      'Bongaigaon': { lat: 26.4746, lng: 90.5583, zoom: 12 }
    }
  },
  'Bihar': {
    center: { lat: 25.0961, lng: 85.3131 },
    zoom: 7,
    districts: {
      'Patna': { lat: 25.5941, lng: 85.1376, zoom: 12 },
      'Gaya': { lat: 24.7914, lng: 85.0002, zoom: 12 },
      'Bhagalpur': { lat: 25.2425, lng: 87.0124, zoom: 12 },
      'Muzaffarpur': { lat: 26.1209, lng: 85.3647, zoom: 12 },
      'Purnia': { lat: 25.7771, lng: 87.4753, zoom: 12 },
      'Darbhanga': { lat: 26.1542, lng: 85.8918, zoom: 12 },
      'Bihar Sharif': { lat: 25.1982, lng: 85.5149, zoom: 12 },
      'Arrah': { lat: 25.5560, lng: 84.6603, zoom: 12 },
      'Begusarai': { lat: 25.4182, lng: 86.1272, zoom: 12 },
      'Katihar': { lat: 25.5398, lng: 87.5740, zoom: 12 }
    }
  },
  'Chandigarh': {
    center: { lat: 30.7333, lng: 76.7794 },
    zoom: 11,
    districts: {
      'Chandigarh Sector 17': { lat: 30.7398, lng: 76.7827, zoom: 13 },
      'Chandigarh Sector 35': { lat: 30.7258, lng: 76.7645, zoom: 13 },
      'Industrial Area Phase 1': { lat: 30.7046, lng: 76.8010, zoom: 13 }
    }
  },
  'Chhattisgarh': {
    center: { lat: 21.2787, lng: 81.8661 },
    zoom: 7,
    districts: {
      'Raipur': { lat: 21.2514, lng: 81.6296, zoom: 12 },
      'Bhilai': { lat: 21.1938, lng: 81.3509, zoom: 12 },
      'Bilaspur': { lat: 22.0797, lng: 82.1391, zoom: 12 },
      'Korba': { lat: 22.3595, lng: 82.7501, zoom: 12 },
      'Rajnandgaon': { lat: 21.1011, lng: 81.0336, zoom: 12 },
      'Durg': { lat: 21.1904, lng: 81.2849, zoom: 12 },
      'Raigarh': { lat: 21.8974, lng: 83.3950, zoom: 12 },
      'Jagdalpur': { lat: 19.0744, lng: 82.0223, zoom: 12 }
    }
  },
  'Dadra & Nagar Haveli and Daman & Diu': {
    center: { lat: 20.4283, lng: 72.8397 },
    zoom: 9,
    districts: {
      'Daman': { lat: 20.3974, lng: 72.8328, zoom: 12 },
      'Diu': { lat: 20.7144, lng: 70.9822, zoom: 12 },
      'Silvassa': { lat: 20.2763, lng: 73.0083, zoom: 12 }
    }
  },
  'Delhi NCR': {
    center: { lat: 28.6139, lng: 77.2090 },
    zoom: 10,
    districts: {
      'New Delhi': { lat: 28.6139, lng: 77.2090, zoom: 12 },
      'Central Delhi': { lat: 28.6469, lng: 77.2167, zoom: 12 },
      'South Delhi': { lat: 28.5355, lng: 77.2610, zoom: 12 },
      'North Delhi': { lat: 28.7041, lng: 77.1025, zoom: 12 },
      'East Delhi': { lat: 28.6273, lng: 77.2949, zoom: 12 },
      'West Delhi': { lat: 28.6369, lng: 77.0904, zoom: 12 },
      'Gurugram': { lat: 28.4595, lng: 77.0266, zoom: 12 },
      'Noida': { lat: 28.5355, lng: 77.3910, zoom: 12 },
      'Ghaziabad': { lat: 28.6692, lng: 77.4538, zoom: 12 },
      'Faridabad': { lat: 28.4089, lng: 77.3178, zoom: 12 }
    }
  },
  'Goa': {
    center: { lat: 15.2993, lng: 74.1240 },
    zoom: 10,
    districts: {
      'Panaji (North Goa)': { lat: 15.4909, lng: 73.8278, zoom: 12 },
      'Margao (South Goa)': { lat: 15.2832, lng: 73.9862, zoom: 12 },
      'Vasco da Gama': { lat: 15.3982, lng: 73.8114, zoom: 12 },
      'Mapusa': { lat: 15.5937, lng: 73.8142, zoom: 12 },
      'Ponda': { lat: 15.4026, lng: 74.0156, zoom: 12 }
    }
  },
  'Gujarat': {
    center: { lat: 22.2587, lng: 71.1924 },
    zoom: 7,
    districts: {
      'Ahmedabad': { lat: 23.0225, lng: 72.5714, zoom: 12 },
      'Surat': { lat: 21.1702, lng: 72.8311, zoom: 12 },
      'Vadodara': { lat: 22.3072, lng: 73.1812, zoom: 12 },
      'Rajkot': { lat: 22.3039, lng: 70.8022, zoom: 12 },
      'Bhavnagar': { lat: 21.7645, lng: 72.1519, zoom: 12 },
      'Jamnagar': { lat: 22.4707, lng: 70.0577, zoom: 12 },
      'Junagadh': { lat: 21.5222, lng: 70.4579, zoom: 12 },
      'Gandhinagar': { lat: 23.2156, lng: 72.6369, zoom: 12 },
      'Anand': { lat: 22.5645, lng: 72.9289, zoom: 12 },
      'Navsari': { lat: 20.9467, lng: 72.9520, zoom: 12 },
      'Morbi': { lat: 22.8173, lng: 70.8373, zoom: 12 }
    }
  },
  'Haryana': {
    center: { lat: 29.0588, lng: 76.0856 },
    zoom: 8,
    districts: {
      'Gurugram': { lat: 28.4595, lng: 77.0266, zoom: 12 },
      'Faridabad': { lat: 28.4089, lng: 77.3178, zoom: 12 },
      'Panipat': { lat: 29.3909, lng: 76.9635, zoom: 12 },
      'Ambala': { lat: 30.3782, lng: 76.7767, zoom: 12 },
      'Yamunanagar': { lat: 30.1290, lng: 77.2674, zoom: 12 },
      'Rohtak': { lat: 28.8955, lng: 76.6066, zoom: 12 },
      'Hisar': { lat: 29.1492, lng: 75.7217, zoom: 12 },
      'Karnal': { lat: 29.6857, lng: 76.9905, zoom: 12 },
      'Sonipat': { lat: 28.9931, lng: 77.0151, zoom: 12 },
      'Panchkula': { lat: 30.6942, lng: 76.8606, zoom: 12 }
    }
  },
  'Himachal Pradesh': {
    center: { lat: 31.1048, lng: 77.1734 },
    zoom: 8,
    districts: {
      'Shimla': { lat: 31.1048, lng: 77.1734, zoom: 12 },
      'Dharamshala': { lat: 32.2190, lng: 76.3234, zoom: 12 },
      'Solan': { lat: 30.9084, lng: 77.0999, zoom: 12 },
      'Mandi': { lat: 31.5892, lng: 76.9182, zoom: 12 },
      'Kullu / Manali': { lat: 31.9579, lng: 77.1095, zoom: 12 },
      'Hamirpur': { lat: 31.6862, lng: 76.5213, zoom: 12 },
      'Bilaspur': { lat: 31.3260, lng: 76.7594, zoom: 12 },
      'Una': { lat: 31.4685, lng: 76.2708, zoom: 12 }
    }
  },
  'Jammu & Kashmir': {
    center: { lat: 33.7782, lng: 76.5762 },
    zoom: 7,
    districts: {
      'Srinagar': { lat: 34.0837, lng: 74.7973, zoom: 12 },
      'Jammu': { lat: 32.7266, lng: 74.8570, zoom: 12 },
      'Anantnag': { lat: 33.7311, lng: 75.1475, zoom: 12 },
      'Baramulla': { lat: 34.2081, lng: 74.3435, zoom: 12 },
      'Udhampur': { lat: 32.9244, lng: 75.1384, zoom: 12 }
    }
  },
  'Jharkhand': {
    center: { lat: 23.6102, lng: 85.2799 },
    zoom: 7,
    districts: {
      'Ranchi': { lat: 23.3441, lng: 85.3096, zoom: 12 },
      'Jamshedpur': { lat: 22.8046, lng: 86.2029, zoom: 12 },
      'Dhanbad': { lat: 23.7957, lng: 86.4304, zoom: 12 },
      'Bokaro Steel City': { lat: 23.6693, lng: 86.1511, zoom: 12 },
      'Hazaribagh': { lat: 23.9925, lng: 85.3637, zoom: 12 },
      'Deoghar': { lat: 24.4826, lng: 86.6977, zoom: 12 },
      'Giridih': { lat: 24.1900, lng: 86.3000, zoom: 12 }
    }
  },
  'Karnataka': {
    center: { lat: 15.3173, lng: 75.7139 },
    zoom: 7,
    districts: {
      'Bengaluru Urban': { lat: 12.9716, lng: 77.5946, zoom: 12 },
      'Mysuru': { lat: 12.2958, lng: 76.6394, zoom: 12 },
      'Mangaluru': { lat: 12.9141, lng: 74.8560, zoom: 12 },
      'Hubballi-Dharwad': { lat: 15.3647, lng: 75.1240, zoom: 12 },
      'Belagavi': { lat: 15.8497, lng: 74.4977, zoom: 12 },
      'Kalaburagi': { lat: 17.3297, lng: 76.8343, zoom: 12 },
      'Davanagere': { lat: 14.4644, lng: 75.9218, zoom: 12 },
      'Ballari': { lat: 15.1394, lng: 76.9214, zoom: 12 },
      'Shimoga (Shivamogga)': { lat: 13.9299, lng: 75.5681, zoom: 12 },
      'Tumakuru': { lat: 13.3409, lng: 77.1006, zoom: 12 }
    }
  },
  'Kerala': {
    center: { lat: 10.8505, lng: 76.2711 },
    zoom: 8,
    districts: {
      'Thiruvananthapuram': { lat: 8.5241, lng: 76.9366, zoom: 12 },
      'Kochi (Ernakulam)': { lat: 9.9312, lng: 76.2673, zoom: 12 },
      'Kozhikode': { lat: 11.2588, lng: 75.7804, zoom: 12 },
      'Thrissur': { lat: 10.5276, lng: 76.2144, zoom: 12 },
      'Kollam': { lat: 8.8932, lng: 76.6141, zoom: 12 },
      'Palakkad': { lat: 10.7867, lng: 76.6548, zoom: 12 },
      'Alappuzha': { lat: 9.4981, lng: 76.3388, zoom: 12 },
      'Kannur': { lat: 11.8745, lng: 75.3704, zoom: 12 },
      'Kottayam': { lat: 9.5916, lng: 76.5222, zoom: 12 }
    }
  },
  'Ladakh': {
    center: { lat: 34.1526, lng: 77.5771 },
    zoom: 8,
    districts: {
      'Leh': { lat: 34.1526, lng: 77.5771, zoom: 12 },
      'Kargil': { lat: 34.5539, lng: 76.1349, zoom: 12 }
    }
  },
  'Lakshadweep': {
    center: { lat: 10.5667, lng: 72.6417 },
    zoom: 10,
    districts: {
      'Kavaratti': { lat: 10.5667, lng: 72.6417, zoom: 13 },
      'Agatti': { lat: 10.8533, lng: 72.1948, zoom: 13 }
    }
  },
  'Madhya Pradesh': {
    center: { lat: 23.2599, lng: 77.4126 },
    zoom: 7,
    districts: {
      'Indore': { lat: 22.7196, lng: 75.8577, zoom: 12 },
      'Bhopal': { lat: 23.2599, lng: 77.4126, zoom: 12 },
      'Jabalpur': { lat: 23.1815, lng: 79.9864, zoom: 12 },
      'Gwalior': { lat: 26.2183, lng: 78.1828, zoom: 12 },
      'Ujjain': { lat: 23.1765, lng: 75.7885, zoom: 12 },
      'Sagar': { lat: 23.8388, lng: 78.7378, zoom: 12 },
      'Dewas': { lat: 22.9676, lng: 76.0534, zoom: 12 },
      'Satna': { lat: 24.6005, lng: 80.8322, zoom: 12 },
      'Ratlam': { lat: 23.3315, lng: 75.0367, zoom: 12 },
      'Rewa': { lat: 24.5362, lng: 81.3037, zoom: 12 },
      'Singrauli': { lat: 24.1992, lng: 82.6645, zoom: 12 },
      'Burhanpur': { lat: 21.3145, lng: 76.2307, zoom: 12 },
      'Khandwa': { lat: 21.8314, lng: 76.3498, zoom: 12 },
      'Katni': { lat: 23.8343, lng: 80.3962, zoom: 12 }
    }
  },
  'Maharashtra': {
    center: { lat: 19.7515, lng: 75.7139 },
    zoom: 7,
    districts: {
      'Mumbai': { lat: 19.0760, lng: 72.8777, zoom: 12 },
      'Pune': { lat: 18.5204, lng: 73.8567, zoom: 12 },
      'Nagpur': { lat: 21.1458, lng: 79.0882, zoom: 12 },
      'Thane': { lat: 19.2183, lng: 72.9781, zoom: 12 },
      'Pimpri-Chinchwad': { lat: 18.6298, lng: 73.7997, zoom: 12 },
      'Nashik': { lat: 19.9975, lng: 73.7898, zoom: 12 },
      'Kalyan-Dombivli': { lat: 19.2403, lng: 73.1305, zoom: 12 },
      'Vasai-Virar': { lat: 19.3919, lng: 72.8397, zoom: 12 },
      'Chhatrapati Sambhajinagar': { lat: 19.8762, lng: 75.3433, zoom: 12 },
      'Solapur': { lat: 17.6599, lng: 75.9064, zoom: 12 },
      'Mira-Bhayandar': { lat: 19.2812, lng: 72.8561, zoom: 12 },
      'Amravati': { lat: 20.9374, lng: 77.7796, zoom: 12 },
      'Nanded': { lat: 19.1383, lng: 77.3210, zoom: 12 },
      'Kolhapur': { lat: 16.7050, lng: 74.2433, zoom: 12 },
      'Sangli': { lat: 16.8524, lng: 74.5815, zoom: 12 }
    }
  },
  'Manipur': {
    center: { lat: 24.6637, lng: 93.9063 },
    zoom: 8,
    districts: {
      'Imphal': { lat: 24.8170, lng: 93.9368, zoom: 12 },
      'Churachandpur': { lat: 24.3333, lng: 93.6833, zoom: 12 },
      'Thoubal': { lat: 24.6406, lng: 93.9989, zoom: 12 },
      'Ukhrul': { lat: 25.1167, lng: 94.3667, zoom: 12 }
    }
  },
  'Meghalaya': {
    center: { lat: 25.4670, lng: 91.3662 },
    zoom: 8,
    districts: {
      'Shillong': { lat: 25.5788, lng: 91.8933, zoom: 12 },
      'Tura': { lat: 25.5142, lng: 90.2032, zoom: 12 },
      'Jowai': { lat: 25.4500, lng: 92.2000, zoom: 12 },
      'Nongpoh': { lat: 25.9038, lng: 91.8812, zoom: 12 }
    }
  },
  'Mizoram': {
    center: { lat: 23.1645, lng: 92.9376 },
    zoom: 8,
    districts: {
      'Aizawl': { lat: 23.7271, lng: 92.7176, zoom: 12 },
      'Lunglei': { lat: 22.8872, lng: 92.7350, zoom: 12 },
      'Champhai': { lat: 23.4739, lng: 93.3298, zoom: 12 }
    }
  },
  'Nagaland': {
    center: { lat: 26.1584, lng: 94.5624 },
    zoom: 8,
    districts: {
      'Kohima': { lat: 25.6751, lng: 94.1086, zoom: 12 },
      'Dimapur': { lat: 25.9060, lng: 93.7272, zoom: 12 },
      'Mokokchung': { lat: 26.3235, lng: 94.5244, zoom: 12 },
      'Tuensang': { lat: 26.2307, lng: 94.8236, zoom: 12 }
    }
  },
  'Odisha': {
    center: { lat: 20.9517, lng: 85.0985 },
    zoom: 7,
    districts: {
      'Bhubaneswar': { lat: 20.2961, lng: 85.8245, zoom: 12 },
      'Cuttack': { lat: 20.4625, lng: 85.8828, zoom: 12 },
      'Rourkela': { lat: 22.2604, lng: 84.8536, zoom: 12 },
      'Berhampur': { lat: 19.3150, lng: 84.7941, zoom: 12 },
      'Sambalpur': { lat: 21.4669, lng: 83.9812, zoom: 12 },
      'Puri': { lat: 19.8135, lng: 85.8312, zoom: 12 },
      'Balasore': { lat: 21.4934, lng: 86.9135, zoom: 12 },
      'Bhadrak': { lat: 21.0574, lng: 86.4960, zoom: 12 }
    }
  },
  'Puducherry': {
    center: { lat: 11.9416, lng: 79.8083 },
    zoom: 11,
    districts: {
      'Puducherry': { lat: 11.9416, lng: 79.8083, zoom: 13 },
      'Karaikal': { lat: 10.9254, lng: 79.8380, zoom: 13 },
      'Mahe': { lat: 11.7002, lng: 75.5347, zoom: 13 },
      'Yanam': { lat: 16.7328, lng: 82.2140, zoom: 13 }
    }
  },
  'Punjab': {
    center: { lat: 31.1471, lng: 75.3412 },
    zoom: 8,
    districts: {
      'Ludhiana': { lat: 30.9010, lng: 75.8573, zoom: 12 },
      'Amritsar': { lat: 31.6340, lng: 74.8723, zoom: 12 },
      'Jalandhar': { lat: 31.3260, lng: 75.5762, zoom: 12 },
      'Patiala': { lat: 30.3398, lng: 76.3869, zoom: 12 },
      'Bathinda': { lat: 30.2110, lng: 74.9455, zoom: 12 },
      'Mohali (SAS Nagar)': { lat: 30.7046, lng: 76.7179, zoom: 12 },
      'Hoshiarpur': { lat: 31.5273, lng: 75.9134, zoom: 12 },
      'Pathankot': { lat: 32.2663, lng: 75.5947, zoom: 12 }
    }
  },
  'Rajasthan': {
    center: { lat: 27.0238, lng: 74.2179 },
    zoom: 7,
    districts: {
      'Jaipur': { lat: 26.9124, lng: 75.7873, zoom: 12 },
      'Jodhpur': { lat: 26.2389, lng: 73.0243, zoom: 12 },
      'Kota': { lat: 25.2138, lng: 75.8648, zoom: 12 },
      'Bikaner': { lat: 28.0229, lng: 73.3119, zoom: 12 },
      'Ajmer': { lat: 26.4499, lng: 74.6399, zoom: 12 },
      'Udaipur': { lat: 24.5854, lng: 73.7125, zoom: 12 },
      'Bhilwara': { lat: 25.3407, lng: 74.6313, zoom: 12 },
      'Alwar': { lat: 27.5530, lng: 76.6346, zoom: 12 },
      'Sikar': { lat: 27.6098, lng: 75.1398, zoom: 12 },
      'Bharatpur': { lat: 27.2152, lng: 77.4930, zoom: 12 }
    }
  },
  'Sikkim': {
    center: { lat: 27.5330, lng: 88.5122 },
    zoom: 9,
    districts: {
      'Gangtok': { lat: 27.3389, lng: 88.6065, zoom: 13 },
      'Namchi': { lat: 27.1667, lng: 88.3500, zoom: 13 },
      'Geyzing': { lat: 27.2833, lng: 88.2500, zoom: 13 },
      'Mangan': { lat: 27.5167, lng: 88.5333, zoom: 13 }
    }
  },
  'Tamil Nadu': {
    center: { lat: 11.1271, lng: 78.6569 },
    zoom: 7,
    districts: {
      'Chennai': { lat: 13.0827, lng: 80.2707, zoom: 12 },
      'Coimbatore': { lat: 11.0168, lng: 76.9558, zoom: 12 },
      'Madurai': { lat: 9.9252, lng: 78.1198, zoom: 12 },
      'Tiruchirappalli': { lat: 10.7905, lng: 78.7047, zoom: 12 },
      'Salem': { lat: 11.6643, lng: 78.1460, zoom: 12 },
      'Tiruppur': { lat: 11.1085, lng: 77.3411, zoom: 12 },
      'Erode': { lat: 11.3410, lng: 77.7172, zoom: 12 },
      'Vellore': { lat: 12.9165, lng: 79.1325, zoom: 12 },
      'Tirunelveli': { lat: 8.7139, lng: 77.7567, zoom: 12 },
      'Thoothukudi': { lat: 8.7642, lng: 78.1348, zoom: 12 },
      'Nagercoil': { lat: 8.1833, lng: 77.4119, zoom: 12 },
      'Thanjavur': { lat: 10.7870, lng: 79.1378, zoom: 12 }
    }
  },
  'Telangana': {
    center: { lat: 18.1124, lng: 79.0193 },
    zoom: 7,
    districts: {
      'Hyderabad': { lat: 17.3850, lng: 78.4867, zoom: 12 },
      'Warangal': { lat: 17.9689, lng: 79.5941, zoom: 12 },
      'Nizamabad': { lat: 18.6725, lng: 78.0941, zoom: 12 },
      'Karimnagar': { lat: 18.4386, lng: 79.1288, zoom: 12 },
      'Ramagundam': { lat: 18.8000, lng: 79.4500, zoom: 12 },
      'Khammam': { lat: 17.2473, lng: 80.1514, zoom: 12 },
      'Mahbubnagar': { lat: 16.7488, lng: 77.9856, zoom: 12 },
      'Nalgonda': { lat: 17.0577, lng: 79.2684, zoom: 12 }
    }
  },
  'Tripura': {
    center: { lat: 23.9408, lng: 91.9882 },
    zoom: 9,
    districts: {
      'Agartala': { lat: 23.8315, lng: 91.2868, zoom: 12 },
      'Udaipur': { lat: 23.5333, lng: 91.4833, zoom: 12 },
      'Dharmanagar': { lat: 24.3667, lng: 92.1667, zoom: 12 },
      'Kailashahar': { lat: 24.3333, lng: 92.0000, zoom: 12 }
    }
  },
  'Uttar Pradesh': {
    center: { lat: 26.8467, lng: 80.9462 },
    zoom: 7,
    districts: {
      'Lucknow': { lat: 26.8467, lng: 80.9462, zoom: 12 },
      'Kanpur': { lat: 26.4499, lng: 80.3319, zoom: 12 },
      'Ghaziabad': { lat: 28.6692, lng: 77.4538, zoom: 12 },
      'Agra': { lat: 27.1767, lng: 78.0081, zoom: 12 },
      'Meerut': { lat: 28.9845, lng: 77.7064, zoom: 12 },
      'Varanasi': { lat: 25.3176, lng: 82.9739, zoom: 12 },
      'Prayagraj (Allahabad)': { lat: 25.4358, lng: 81.8463, zoom: 12 },
      'Bareilly': { lat: 28.3670, lng: 79.4304, zoom: 12 },
      'Aligarh': { lat: 27.8974, lng: 78.0880, zoom: 12 },
      'Moradabad': { lat: 28.8386, lng: 78.7733, zoom: 12 },
      'Saharanpur': { lat: 29.9640, lng: 77.5460, zoom: 12 },
      'Gorakhpur': { lat: 26.7606, lng: 83.3732, zoom: 12 },
      'Noida': { lat: 28.5355, lng: 77.3910, zoom: 12 },
      'Firozabad': { lat: 27.1592, lng: 78.3957, zoom: 12 },
      'Jhansi': { lat: 25.4484, lng: 78.5685, zoom: 12 }
    }
  },
  'Uttarakhand': {
    center: { lat: 30.0668, lng: 79.0193 },
    zoom: 8,
    districts: {
      'Dehradun': { lat: 30.3165, lng: 78.0322, zoom: 12 },
      'Haridwar': { lat: 29.9457, lng: 78.1642, zoom: 12 },
      'Roorkee': { lat: 29.8543, lng: 77.8880, zoom: 12 },
      'Haldwani': { lat: 29.2183, lng: 79.5130, zoom: 12 },
      'Rudrapur': { lat: 28.9800, lng: 79.4000, zoom: 12 },
      'Kashipur': { lat: 29.2100, lng: 78.9600, zoom: 12 },
      'Rishikesh': { lat: 30.0869, lng: 78.2676, zoom: 12 }
    }
  },
  'West Bengal': {
    center: { lat: 22.9868, lng: 87.8550 },
    zoom: 7,
    districts: {
      'Kolkata': { lat: 22.5726, lng: 88.3639, zoom: 12 },
      'Asansol': { lat: 23.6889, lng: 86.9661, zoom: 12 },
      'Siliguri': { lat: 26.7271, lng: 88.3953, zoom: 12 },
      'Durgapur': { lat: 23.5204, lng: 87.3119, zoom: 12 },
      'Bardhaman': { lat: 23.2324, lng: 87.8615, zoom: 12 },
      'Malda': { lat: 25.0108, lng: 88.1411, zoom: 12 },
      'Baharampur': { lat: 24.1000, lng: 88.2500, zoom: 12 },
      'Habra': { lat: 22.8300, lng: 88.6300, zoom: 12 },
      'Kharagpur': { lat: 22.3460, lng: 87.2320, zoom: 12 },
      'Shantipur': { lat: 23.2500, lng: 88.4300, zoom: 12 },
      'Dankuni': { lat: 22.6800, lng: 88.3000, zoom: 12 }
    }
  }
};

const HeatMap = () => {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [opacity, setOpacity] = useState(0.7);
  const [radius, setRadius] = useState(40);
  const [gradient, setGradient] = useState('Default');
  const [timeframe, setTimeframe] = useState('all');

  // REAL DATA STATES
  const [points, setPoints] = useState([]);
  const [cityRankings, setCityRankings] = useState([]);
  const [summary, setSummary] = useState({ totalBookings: 0, activeHotspots: 0, onlineDrivers: 0, topCity: 'N/A' });

  // REGIONAL FILTER STATES
  const [selectedState, setSelectedState] = useState('');
  const [selectedDistrict, setSelectedDistrict] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [mapCenter, setMapCenter] = useState(INDIA_CENTER);
  const [mapZoom, setMapZoom] = useState(5);
  const [mapRef, setMapRef] = useState(null);

  const { isLoaded, loadError } = useAppGoogleMapsLoader();

  // FETCH REAL DYNAMIC HEATMAP DATA FROM BACKEND MONGODB DATABASE
  const fetchHeatmapData = async () => {
    setLoading(true);
    try {
      const res = await adminService.getHeatmapAnalytics({
        state: selectedState,
        district: selectedDistrict,
        timeframe,
      });
      const data = res?.data || res || {};
      const fetchedPoints = data.points || [];
      const fetchedRankings = data.cityRankings || [];
      const fetchedSummary = data.summary || { totalBookings: 0, activeHotspots: 0, onlineDrivers: 0, topCity: 'N/A' };

      setPoints(fetchedPoints);
      setCityRankings(fetchedRankings);
      setSummary(fetchedSummary);

      // If map center is default and points exist, auto-center to top booking
      if (fetchedPoints.length > 0 && mapCenter.lat === INDIA_CENTER.lat && !selectedState && !selectedDistrict) {
        const topPoint = fetchedPoints[0];
        setMapCenter({ lat: topPoint.lat, lng: topPoint.lng });
        setMapZoom(11);
        if (mapRef) {
          mapRef.panTo({ lat: topPoint.lat, lng: topPoint.lng });
          mapRef.setZoom(11);
        }
      }
    } catch (error) {
      console.error('Failed to fetch real heatmap analytics:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchHeatmapData();
  }, [selectedState, selectedDistrict, timeframe]);

  // Handle State Selection
  const handleStateChange = (stateName) => {
    setSelectedState(stateName);
    setSelectedDistrict('');
    if (!stateName) {
      setMapCenter(INDIA_CENTER);
      setMapZoom(5);
      if (mapRef) {
        mapRef.panTo(INDIA_CENTER);
        mapRef.setZoom(5);
      }
      return;
    }

    const stateData = ALL_INDIA_STATES_DATA[stateName];
    if (stateData) {
      setMapCenter(stateData.center);
      setMapZoom(stateData.zoom || 7);
      if (mapRef) {
        mapRef.panTo(stateData.center);
        mapRef.setZoom(stateData.zoom || 7);
      }
    }
  };

  // Handle District Selection
  const handleDistrictChange = (districtName) => {
    setSelectedDistrict(districtName);
    if (!districtName) {
      if (selectedState && ALL_INDIA_STATES_DATA[selectedState]) {
        const stateCenter = ALL_INDIA_STATES_DATA[selectedState].center;
        setMapCenter(stateCenter);
        setMapZoom(ALL_INDIA_STATES_DATA[selectedState].zoom || 7);
        if (mapRef) {
          mapRef.panTo(stateCenter);
          mapRef.setZoom(ALL_INDIA_STATES_DATA[selectedState].zoom || 7);
        }
      }
      return;
    }

    if (selectedState && ALL_INDIA_STATES_DATA[selectedState]?.districts?.[districtName]) {
      const distObj = ALL_INDIA_STATES_DATA[selectedState].districts[districtName];
      const newCenter = { lat: distObj.lat, lng: distObj.lng };
      setMapCenter(newCenter);
      setMapZoom(distObj.zoom || 12);
      if (mapRef) {
        mapRef.panTo(newCenter);
        mapRef.setZoom(distObj.zoom || 12);
      }
    }
  };

  // Jump Map to City from Rankings Table
  const handleJumpToCity = (cityName) => {
    setSearchQuery(cityName);
    // Find matching state & city
    for (const [sName, sData] of Object.entries(ALL_INDIA_STATES_DATA)) {
      if (sName.toLowerCase() === cityName.toLowerCase()) {
        handleStateChange(sName);
        return;
      }
      for (const [dName, dData] of Object.entries(sData.districts)) {
        if (dName.toLowerCase().includes(cityName.toLowerCase())) {
          setSelectedState(sName);
          handleDistrictChange(dName);
          return;
        }
      }
    }
  };

  // Handle Search Query Submission
  const handleSearchSubmit = (e) => {
    e.preventDefault();
    if (!searchQuery.trim()) return;

    const query = searchQuery.trim().toLowerCase();

    for (const [sName, sData] of Object.entries(ALL_INDIA_STATES_DATA)) {
      if (sName.toLowerCase() === query || sName.toLowerCase().includes(query)) {
        handleStateChange(sName);
        return;
      }
      for (const [dName, dData] of Object.entries(sData.districts)) {
        if (dName.toLowerCase() === query || dName.toLowerCase().includes(query)) {
          setSelectedState(sName);
          handleDistrictChange(dName);
          return;
        }
      }
    }

    if (window.google && window.google.maps && window.google.maps.Geocoder) {
      const geocoder = new window.google.maps.Geocoder();
      geocoder.geocode({ address: `${searchQuery}, India` }, (results, status) => {
        if (status === 'OK' && results[0]) {
          const loc = results[0].geometry.location;
          const newCenter = { lat: loc.lat(), lng: loc.lng() };
          setMapCenter(newCenter);
          setMapZoom(13);
          if (mapRef) {
            mapRef.panTo(newCenter);
            mapRef.setZoom(13);
          }
        }
      });
    }
  };

  const handleResetFilters = () => {
    setSelectedState('');
    setSelectedDistrict('');
    setSearchQuery('');
    setTimeframe('all');
    setMapCenter(INDIA_CENTER);
    setMapZoom(5);
    if (mapRef) {
      mapRef.panTo(INDIA_CENTER);
      mapRef.setZoom(5);
    }
  };

  const onMapLoad = useCallback((map) => {
    setMapRef(map);
  }, []);

  const inputClass = "w-full border border-gray-200 rounded-2xl px-4 py-3 text-xs font-bold text-gray-800 bg-white focus:border-indigo-600 focus:ring-2 focus:ring-indigo-100 outline-none transition";
  const labelClass = "block text-[11px] font-black uppercase tracking-wider text-gray-400 mb-1.5";

  const activeDistrictList = selectedState ? Object.keys(ALL_INDIA_STATES_DATA[selectedState]?.districts || {}) : [];
  const stateKeysList = Object.keys(ALL_INDIA_STATES_DATA);

  return (
    <div className="min-h-screen bg-gray-50/50 p-4 md:p-6 lg:p-8 font-sans space-y-6">
      
      {/* 1. Header Block */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-gradient-to-r from-slate-900 via-indigo-950 to-slate-900 text-white p-8 rounded-3xl shadow-xl border border-slate-800">
        <div>
          <div className="inline-flex items-center gap-2 px-3.5 py-1 bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 rounded-full text-xs font-black uppercase tracking-wider mb-2">
            <Flame size={14} /> Live MongoDB Booking Heatmap Engine
          </div>
          <h1 className="text-3xl font-black">Real-Time Demand & Booking Heat Map</h1>
          <p className="text-xs text-slate-300 mt-1 max-w-xl font-medium">
            Fetching real dynamic ride pickup locations and driver positions directly from MongoDB.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button 
             onClick={() => navigate('/admin/dashboard')}
             className="flex items-center gap-2 px-5 py-3 text-xs font-black text-white bg-slate-800/80 hover:bg-slate-800 border border-slate-700/80 rounded-2xl transition shadow-md"
          >
            <ArrowLeft size={16} /> Back to Dashboard
          </button>
        </div>
      </div>

      {/* 2. REGIONAL SEARCH & FILTER BAR */}
      <div className="bg-white p-6 rounded-3xl border border-gray-100 shadow-sm space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-black uppercase tracking-wider text-indigo-600 flex items-center gap-2">
            <Filter size={16} /> Filter Dynamic Demand Data by Region & Timeframe
          </h3>
          {(selectedState || selectedDistrict || searchQuery || timeframe !== 'all') && (
            <button
              onClick={handleResetFilters}
              className="text-xs font-bold text-rose-600 hover:text-rose-700 flex items-center gap-1.5 bg-rose-50 px-3.5 py-1.5 rounded-xl transition border border-rose-100"
            >
              <X size={14} /> Reset Filters
            </button>
          )}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          {/* SEARCH BAR */}
          <form onSubmit={handleSearchSubmit} className="relative">
            <label className={labelClass}>Search City / Area / Landmark</label>
            <div className="relative">
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="e.g. Indore, Mumbai, Bengaluru..."
                className={`${inputClass} pr-10`}
              />
              <button type="submit" className="absolute right-3 top-3 text-gray-400 hover:text-indigo-600">
                <Search size={16} />
              </button>
            </div>
          </form>

          {/* STATE FILTER */}
          <div>
            <label className={labelClass}>Filter by State / UT</label>
            <select
              value={selectedState}
              onChange={(e) => handleStateChange(e.target.value)}
              className={inputClass}
            >
              <option value="">All India (Nationwide View)</option>
              {stateKeysList.map((st) => (
                <option key={st} value={st}>{st}</option>
              ))}
            </select>
          </div>

          {/* DISTRICT FILTER */}
          <div>
            <label className={labelClass}>Filter by District / City</label>
            <select
              value={selectedDistrict}
              onChange={(e) => handleDistrictChange(e.target.value)}
              disabled={!selectedState}
              className={`${inputClass} ${!selectedState ? 'bg-gray-100 text-gray-400 cursor-not-allowed' : ''}`}
            >
              <option value="">{selectedState ? `All Cities in ${selectedState}` : 'Select a State first...'}</option>
              {activeDistrictList.map((dist) => (
                <option key={dist} value={dist}>{dist}</option>
              ))}
            </select>
          </div>

          {/* TIMEFRAME FILTER */}
          <div>
            <label className={labelClass}>Booking Timeframe</label>
            <select
              value={timeframe}
              onChange={(e) => setTimeframe(e.target.value)}
              className={inputClass}
            >
              <option value="all">All Historical Bookings</option>
              <option value="today">Today's Live Bookings</option>
              <option value="7days">Past 7 Days</option>
            </select>
          </div>
        </div>

        {/* ACTIVE FILTER BADGES */}
        <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-gray-50">
          <span className="text-[10px] font-black uppercase text-gray-400 tracking-wider">Live Map Focus:</span>
          <span className="px-3 py-1 bg-indigo-50 text-indigo-700 text-xs font-black rounded-xl border border-indigo-100 flex items-center gap-1.5">
            <MapPin size={13} /> {selectedDistrict ? `${selectedDistrict}, ${selectedState}` : selectedState ? selectedState : 'All India Nationwide View'}
          </span>
          <span className="px-3 py-1 bg-emerald-50 text-emerald-700 text-xs font-bold rounded-xl border border-emerald-100">
            Coordinates: {mapCenter.lat.toFixed(4)}, {mapCenter.lng.toFixed(4)}
          </span>
          <span className="px-3 py-1 bg-amber-50 text-amber-700 text-xs font-bold rounded-xl border border-amber-100">
            Real Pickup Nodes Fetched: {points.length}
          </span>
        </div>
      </div>

      {/* 3. MAP CANVAS & RANKINGS SIDEBAR */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        {/* MAP CANVAS */}
        <div className="lg:col-span-3 bg-white rounded-3xl border border-gray-100 p-3 shadow-sm overflow-hidden relative">
          <div className="rounded-2xl overflow-hidden relative">
            {loadError ? (
              <div className="h-[540px] flex items-center justify-center bg-gray-50 text-rose-500 font-semibold">Map Error</div>
            ) : HAS_VALID_GOOGLE_MAPS_KEY && isLoaded ? (
              <GoogleMap
                mapContainerStyle={MAP_CONTAINER_STYLE}
                center={mapCenter}
                zoom={mapZoom}
                options={mapOptions}
                onLoad={onMapLoad}
              >
                {points.map((overlay) => (
                  <Circle
                    key={overlay.id}
                    center={{ lat: overlay.lat, lng: overlay.lng }}
                    radius={radius * 100 * Math.max(1, (overlay.weight || 4) * 0.2)}
                    options={{
                      fillColor: overlay.type === 'driver' ? '#10b981' : gradient === 'Spectral View' ? '#8b5cf6' : gradient === 'Density Focus' ? '#06b6d4' : '#ef4444',
                      fillOpacity: Math.max(0.25, Math.min(opacity * (overlay.weight || 5) * 0.1, 0.85)),
                      strokeColor: overlay.type === 'driver' ? '#059669' : gradient === 'Spectral View' ? '#6d28d9' : gradient === 'Density Focus' ? '#0891b2' : '#b91c1c',
                      strokeOpacity: Math.max(0.2, Math.min(opacity * 0.7, 0.9)),
                      strokeWeight: 1,
                      clickable: false,
                    }}
                  />
                ))}
              </GoogleMap>
            ) : (
              <div className="h-[540px] flex flex-col items-center justify-center bg-gray-50 gap-4">
                <div className="w-16 h-16 bg-white rounded-2xl flex items-center justify-center shadow-sm text-indigo-600"><MapIcon size={32} /></div>
                <p className="text-[10px] font-black text-gray-400 uppercase tracking-[0.2em]">Map API Key Required</p>
              </div>
            )}
            
            {/* Refresh Badge */}
            <div className="absolute top-6 right-6 flex items-center gap-2">
              <button
                onClick={fetchHeatmapData}
                className="p-3 bg-white hover:bg-gray-50 rounded-2xl shadow-xl flex items-center justify-center text-gray-600 hover:text-indigo-600 transition border border-gray-100"
                title="Refresh Real Heatmap Feed"
              >
                <RefreshCw size={18} className={loading ? 'animate-spin' : ''} />
              </button>
            </div>
          </div>
        </div>

        {/* RANKING & TOP BOOKING CITIES SIDEBAR */}
        <div className="bg-white rounded-3xl border border-gray-100 p-6 shadow-sm flex flex-col justify-between space-y-4">
          <div>
            <div className="flex items-center gap-2 pb-3 border-b border-gray-100 text-indigo-600">
              <BarChart3 size={20} />
              <h3 className="text-xs font-black uppercase tracking-wider text-gray-900">Top Booking Cities</h3>
            </div>

            <p className="text-[11px] text-gray-400 mt-2 font-medium">Click any city below to jump map directly to its booking cluster:</p>

            <div className="mt-4 space-y-2 max-h-[380px] overflow-y-auto pr-1">
              {cityRankings.length === 0 ? (
                <p className="text-xs text-gray-400 italic">No ride bookings recorded yet.</p>
              ) : (
                cityRankings.map((rk, idx) => (
                  <button
                    key={idx}
                    onClick={() => handleJumpToCity(rk.city)}
                    className="w-full p-3 bg-gray-50 hover:bg-indigo-50/70 border border-gray-100 hover:border-indigo-200 rounded-2xl transition flex items-center justify-between text-left group"
                  >
                    <div>
                      <span className="text-xs font-black text-gray-900 group-hover:text-indigo-700">{rk.city}</span>
                      <span className="block text-[10px] text-gray-400 font-medium">Rank #{idx + 1}</span>
                    </div>
                    <span className="px-3 py-1 bg-indigo-100 text-indigo-800 text-xs font-black rounded-xl">
                      {rk.count} {rk.count === 1 ? 'Booking' : 'Bookings'}
                    </span>
                  </button>
                ))
              )}
            </div>
          </div>

          <div className="pt-3 border-t border-gray-100">
            <span className="text-[10px] font-black uppercase tracking-wider text-gray-400 block">Top Demand Hub</span>
            <span className="text-sm font-black text-indigo-600 block">{summary.topCity || 'N/A'}</span>
          </div>
        </div>
      </div>

      {/* 4. VISIBILITY CONTROLS PANEL */}
      <div className="bg-white rounded-3xl border border-gray-100 p-6 shadow-sm space-y-6">
        <div className="flex items-center gap-4 pb-4 border-b border-gray-100">
          <div className="w-10 h-10 bg-indigo-50 rounded-2xl flex items-center justify-center text-indigo-600 shadow-sm">
            <Eye size={20} />
          </div>
          <div>
            <h3 className="text-sm font-black text-gray-900 uppercase tracking-wider">Heatmap Overlay Intensity Controls</h3>
            <p className="text-xs text-gray-400 font-medium">Adjust opacity, node radius, and color spectrum</p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div>
            <label className={labelClass}>
              <Settings2 size={12} className="inline mr-1 text-indigo-500" />
              Gradient Spectrum
            </label>
            <select value={gradient} onChange={e => setGradient(e.target.value)} className={inputClass}>
              <option>Default (Thermal Red)</option>
              <option>Spectral View (Purple)</option>
              <option>Density Focus (Cyan)</option>
            </select>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className={labelClass}>Layer Opacity</label>
              <span className="text-[10px] font-black text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded-lg">{Math.round(opacity * 100)}%</span>
            </div>
            <input 
              type="range" min="0.1" max="1" step="0.05" value={opacity} 
              onChange={e => setOpacity(Number(e.target.value))}
              className="w-full h-2 bg-gray-100 rounded-lg appearance-none cursor-pointer accent-indigo-600"
            />
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className={labelClass}>Node Intensity Radius</label>
              <span className="text-[10px] font-black text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-lg font-mono">{radius}px</span>
            </div>
            <input 
              type="range" min="10" max="100" step="5" value={radius} 
              onChange={e => setRadius(Number(e.target.value))}
              className="w-full h-2 bg-gray-100 rounded-lg appearance-none cursor-pointer accent-emerald-600"
            />
          </div>
        </div>
      </div>

      {/* 5. METRIC CARDS */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        <div className="bg-white rounded-3xl border border-gray-100 p-6 flex items-center gap-5 shadow-sm">
          <div className="w-12 h-12 bg-indigo-50 flex items-center justify-center rounded-2xl text-indigo-600">
            <TrendingUp size={24} />
          </div>
          <div>
            <p className="text-[10px] font-black text-gray-400 uppercase tracking-wider mb-0.5">Total Ride Bookings</p>
            <p className="text-lg font-black text-gray-900">{summary.totalBookings}</p>
          </div>
        </div>

        <div className="bg-white rounded-3xl border border-gray-100 p-6 flex items-center gap-5 shadow-sm">
          <div className="w-12 h-12 bg-emerald-50 flex items-center justify-center rounded-2xl text-emerald-600">
            <Flame size={24} />
          </div>
          <div>
            <p className="text-[10px] font-black text-gray-400 uppercase tracking-wider mb-0.5">Active Demand Hotspots</p>
            <p className="text-lg font-black text-gray-900">{summary.activeHotspots}</p>
          </div>
        </div>

        <div className="bg-white rounded-3xl border border-gray-100 p-6 flex items-center gap-5 shadow-sm">
          <div className="w-12 h-12 bg-teal-50 flex items-center justify-center rounded-2xl text-teal-600">
            <Activity size={24} />
          </div>
          <div>
            <p className="text-[10px] font-black text-gray-400 uppercase tracking-wider mb-0.5">Online Drivers Active</p>
            <p className="text-lg font-black text-gray-900">{summary.onlineDrivers}</p>
          </div>
        </div>

        <div className="bg-white rounded-3xl border border-gray-100 p-6 flex items-center gap-5 shadow-sm">
          <div className="w-12 h-12 bg-amber-50 flex items-center justify-center rounded-2xl text-amber-600">
            <Zap size={24} />
          </div>
          <div>
            <p className="text-[10px] font-black text-gray-400 uppercase tracking-wider mb-0.5">Live Data Feed</p>
            <p className="text-sm font-black text-emerald-600">MongoDB Dynamic API</p>
          </div>
        </div>
      </div>

    </div>
  );
};

export default HeatMap;
