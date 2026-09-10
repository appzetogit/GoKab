import React from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Phone, Mail, MapPin, Clock } from 'lucide-react';

const ContactPage = () => {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-[#FBFBF6] font-sans text-gray-900">
      {/* Header */}
      <div className="fixed top-0 left-0 right-0 bg-[#CFE8C9]/90 backdrop-blur-md z-50 border-b border-gray-200 shadow-sm">
        <div className="max-w-6xl mx-auto px-6 h-16 flex items-center gap-4">
            <button onClick={() => navigate(-1)} className="p-2 hover:bg-gray-100/50 rounded-full transition-all">
              <ArrowLeft size={20} />
            </button>
            <span className="font-bold text-sm uppercase tracking-widest text-[#2F5F43]">Contact Us</span>
        </div>
      </div>

      {/* Hero Section */}
      <div className="bg-[#2F5F43] text-white pt-32 pb-20 px-6">
        <div className="max-w-4xl mx-auto text-center">
            <h1 className="text-5xl md:text-6xl font-black tracking-tight mb-6">
                We're Here to <span className="text-[#F2D34F]">Help</span>
            </h1>
            <p className="text-xl text-gray-200 leading-relaxed max-w-2xl mx-auto">
                Got a question or need assistance? Reach out to our dedicated support team available 24/7.
            </p>
        </div>
      </div>

      {/* Main Content */}
      <div className="max-w-5xl mx-auto px-6 py-20">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            <div className="bg-[#CFE8C9] p-10 rounded-3xl shadow-sm border border-gray-100 flex flex-col items-center text-center">
                <div className="w-16 h-16 bg-[#FBFBF6] rounded-2xl flex items-center justify-center mb-6">
                    <Phone className="text-[#2F5F43]" size={32} />
                </div>
                <h3 className="text-2xl font-bold mb-4 text-[#2F5F43]">Phone Support</h3>
                <p className="text-gray-700 mb-6 leading-relaxed">
                    Call our toll-free line anytime for immediate assistance with your rides or accounts.
                </p>
                <p className="text-3xl font-black text-[#2F5F43]">7409129517</p>
            </div>

            <div className="bg-[#CFE8C9] p-10 rounded-3xl shadow-sm border border-gray-100 flex flex-col items-center text-center">
                <div className="w-16 h-16 bg-[#FBFBF6] rounded-2xl flex items-center justify-center mb-6">
                    <Mail className="text-[#2F5F43]" size={32} />
                </div>
                <h3 className="text-2xl font-bold mb-4 text-[#2F5F43]">Email Us</h3>
                <p className="text-gray-700 mb-6 leading-relaxed">
                    Prefer writing? Send us an email and our team will get back to you within 2 hours.
                </p>
                <p className="text-2xl font-bold text-[#2F5F43]">supportgokab@gmail.com</p>
            </div>

            <div className="bg-[#CFE8C9] p-10 rounded-3xl shadow-sm border border-gray-100 flex flex-col items-center text-center">
                <div className="w-16 h-16 bg-[#FBFBF6] rounded-2xl flex items-center justify-center mb-6">
                    <MapPin className="text-[#2F5F43]" size={32} />
                </div>
                <h3 className="text-2xl font-bold mb-4 text-[#2F5F43]">Headquarters</h3>
                <p className="text-gray-700 mb-6 leading-relaxed">
                    Office No. 110,<br/>B. K Tower, H-65, Sec-63,<br/>Noida 201301
                </p>
            </div>

            <div className="bg-[#CFE8C9] p-10 rounded-3xl shadow-sm border border-gray-100 flex flex-col items-center text-center">
                <div className="w-16 h-16 bg-[#FBFBF6] rounded-2xl flex items-center justify-center mb-6">
                    <Clock className="text-[#2F5F43]" size={32} />
                </div>
                <h3 className="text-2xl font-bold mb-4 text-[#2F5F43]">Operating Hours</h3>
                <p className="text-gray-700 mb-6 leading-relaxed">
                    Our platform operates 24 hours a day, 7 days a week. Support is always online.
                </p>
            </div>
        </div>
      </div>
    </div>
  );
};

export default ContactPage;
