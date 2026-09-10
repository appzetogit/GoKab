import React from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Target, Award, Users, ShieldCheck } from 'lucide-react';

const AboutPage = () => {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-[#FBFBF6] font-sans text-gray-900">
      {/* Header */}
      <div className="fixed top-0 left-0 right-0 bg-[#CFE8C9]/90 backdrop-blur-md z-50 border-b border-gray-200 shadow-sm">
        <div className="max-w-6xl mx-auto px-6 h-16 flex items-center gap-4">
            <button onClick={() => navigate(-1)} className="p-2 hover:bg-gray-100/50 rounded-full transition-all">
              <ArrowLeft size={20} />
            </button>
            <span className="font-bold text-sm uppercase tracking-widest text-[#2F5F43]">About Us</span>
        </div>
      </div>

      {/* Hero Section */}
      <div className="bg-[#2F5F43] text-white pt-32 pb-20 px-6">
        <div className="max-w-4xl mx-auto text-center">
            <h1 className="text-5xl md:text-6xl font-black tracking-tight mb-6">
                Driving the <span className="text-[#F2D34F]">Future</span> of Mobility
            </h1>
            <p className="text-xl text-gray-200 leading-relaxed max-w-2xl mx-auto">
                Gokab is a leading transportation and logistics platform dedicated to providing safe, reliable, and affordable mobility solutions for everyone.
            </p>
        </div>
      </div>

      {/* Main Content */}
      <div className="max-w-6xl mx-auto px-6 py-20">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-16 items-center">
            <div>
                <h2 className="text-3xl font-bold mb-6 text-[#2F5F43]">Our Mission</h2>
                <p className="text-lg text-gray-600 leading-relaxed mb-6">
                    Our mission is to transform the way people move by connecting them with professional drivers and efficient services. We believe that transportation should be seamless, secure, and accessible to all.
                </p>
                <p className="text-lg text-gray-600 leading-relaxed">
                    Whether you need a quick city ride or a comfortable outstation trip, our technology-driven approach ensures every journey is a great experience.
                </p>
            </div>
            <div className="grid grid-cols-2 gap-6">
                <div className="bg-[#CFE8C9] p-6 rounded-2xl shadow-sm border border-gray-100">
                    <Target className="text-[#2F5F43] mb-4" size={32} />
                    <h3 className="font-bold text-lg mb-2 text-[#2F5F43]">Reliability</h3>
                    <p className="text-gray-700 text-sm">Always on time, every time you ride.</p>
                </div>
                <div className="bg-[#CFE8C9] p-6 rounded-2xl shadow-sm border border-gray-100">
                    <ShieldCheck className="text-[#2F5F43] mb-4" size={32} />
                    <h3 className="font-bold text-lg mb-2 text-[#2F5F43]">Safety First</h3>
                    <p className="text-gray-700 text-sm">Verified drivers and secure tracking.</p>
                </div>
                <div className="bg-[#CFE8C9] p-6 rounded-2xl shadow-sm border border-gray-100">
                    <Users className="text-[#2F5F43] mb-4" size={32} />
                    <h3 className="font-bold text-lg mb-2 text-[#2F5F43]">Community</h3>
                    <p className="text-gray-700 text-sm">Empowering riders and drivers alike.</p>
                </div>
                <div className="bg-[#CFE8C9] p-6 rounded-2xl shadow-sm border border-gray-100">
                    <Award className="text-[#2F5F43] mb-4" size={32} />
                    <h3 className="font-bold text-lg mb-2 text-[#2F5F43]">Excellence</h3>
                    <p className="text-gray-700 text-sm">Top-tier service quality guaranteed.</p>
                </div>
            </div>
        </div>
      </div>
    </div>
  );
};

export default AboutPage;
