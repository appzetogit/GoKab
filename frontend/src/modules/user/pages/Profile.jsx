import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  User, Wallet, Bell, Shield, LogOut, ChevronRight, HelpCircle, FileText,
  MapPin, Star, Package, Wrench, Gift, Trash2, Check, BusFront, 
  Settings, CreditCard, Heart, Map, MessageSquare, History, Phone,
  Award, Sparkles
} from 'lucide-react';
import BottomNavbar from '../components/BottomNavbar';
import { clearLocalUserSession, getLocalUserToken, userAuthService } from '../services/authService';
import { clearCurrentRide } from '../services/currentRideService';
import { socketService } from '../../../shared/api/socket';
import api from '../../../shared/api/axiosInstance';

const MotionDiv = motion.div;
const MotionButton = motion.button;

const pickObject = (...values) => values.find((value) => value && typeof value === 'object' && !Array.isArray(value)) || {};

const pickNumber = (...values) => {
  for (const value of values) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return 0;
};

const menuSections = [
  {
    title: 'Personal',
    items: [
      { icon: User, title: 'Profile Settings', sub: 'Manage your personal info', path: '/taxi/user/profile/settings', bg: 'bg-indigo-50', color: 'text-indigo-600' },
      { icon: MapPin, title: 'Saved Addresses', sub: 'Home, office & others', path: '/taxi/user/profile/addresses', bg: 'bg-emerald-50', color: 'text-emerald-600' },
      { icon: History, title: 'My Rides', sub: 'Rides, parcels & trips', path: '/taxi/user/activity', bg: 'bg-blue-50', color: 'text-blue-600' },
    ]
  },
  {
    title: 'Financial & Rewards',
    items: [
      { icon: Wallet, title: 'My Wallet', sub: 'Balance & transactions', path: '/taxi/user/wallet', bg: 'bg-amber-50', color: 'text-amber-600' },
      { icon: Package, title: 'Subscriptions', sub: 'Ride plans & credits', path: '/taxi/user/profile/subscriptions', bg: 'bg-indigo-50', color: 'text-indigo-600' },
      { icon: Gift, title: 'Refer & Earn', sub: 'Invite friends & get rewards', path: '/taxi/user/referral', bg: 'bg-rose-50', color: 'text-rose-600' },
      { icon: BusFront, title: 'Bus Tickets', sub: 'Manage bus bookings', path: '/taxi/user/profile/bus-bookings', bg: 'bg-orange-50', color: 'text-orange-600' },
    ]
  },
  {
    title: 'Preferences',
    items: [
      { icon: Bell, title: 'Notifications', sub: 'Offers & alerts', path: '/taxi/user/profile/notifications', bg: 'bg-purple-50', color: 'text-purple-600' },
      { icon: Shield, title: 'Security & SOS', sub: 'Trust & safety settings', path: '/safety/sos', bg: 'bg-sky-50', color: 'text-sky-600' },
      { icon: HelpCircle, title: 'Help & Support', sub: 'Help center & tickets', path: '/taxi/user/support/tickets', bg: 'bg-slate-50', color: 'text-slate-600' },
    ]
  },
  {
    title: 'Legal',
    items: [
      { icon: FileText, title: 'Terms & Conditions', sub: 'Read service terms', path: '/terms', bg: 'bg-orange-50', color: 'text-orange-600' },
      { icon: Shield, title: 'Privacy Policy', sub: 'How your data is handled', path: '/privacy', bg: 'bg-emerald-50', color: 'text-emerald-600' },
      { icon: CreditCard, title: 'Refund Policy', sub: 'Refunds and cancellations', path: '/refund', bg: 'bg-indigo-50', color: 'text-indigo-600' },
    ]
  }
];

const Profile = () => {
  const navigate = useNavigate();
  const [profile, setProfile] = useState({
    name: '',
    phone: '',
    profileImage: '',
    loyaltyPoints: 0,
    referralWallet: 0,
    lockedReferralAmount: 0,
    availableReferralWallet: 0,
    minimumRedeemAmount: 100,
    stats: {
      trips: 0,
      rating: 4.9,
      wallet: 0
    }
  });

  useEffect(() => {
    const token = getLocalUserToken();

    if (!token) {
      navigate('/taxi/user/login', { replace: true });
      return;
    }

    const loadProfile = async () => {
      try {
        let stored = {};
        try {
          stored = JSON.parse(localStorage.getItem('userInfo') || '{}');
        } catch {
          stored = {};
        }

        const [profileResponse, walletResponse, ridesResponse] = await Promise.allSettled([
          userAuthService.getCurrentUser(),
          userAuthService.getWallet(),
          api.get('/rides', { params: { page: 1, limit: 1 } }),
        ]);

        const profilePayload = profileResponse.status === 'fulfilled' ? profileResponse.value : {};
        const walletPayload = walletResponse.status === 'fulfilled' ? walletResponse.value : {};
        const ridesPayload = ridesResponse.status === 'fulfilled' ? ridesResponse.value : {};

        const profileData = pickObject(
          profilePayload?.data,
          profilePayload?.result,
          profilePayload,
        );
        const user = pickObject(
          profileData?.user,
          profileData?.data?.user,
          profileData?.profile,
          profileData,
        );
        const walletData = pickObject(
          walletPayload?.data,
          walletPayload?.wallet,
          walletPayload,
        );
        const ridesData = pickObject(
          ridesPayload?.data,
          ridesPayload?.result,
          ridesPayload,
        );
        const ridePagination = pickObject(ridesData?.pagination, ridesData?.data?.pagination);
        const dynamicTripCount = pickNumber(
          ridePagination.total,
          ridesData?.total,
          ridesData?.count,
          user.totalRides,
          user.total_trips,
          user.totalTrips,
          stored?.totalRides,
        );
        const dynamicWalletBalance = pickNumber(
          walletData.balance,
          walletData.walletBalance,
          walletData.amount,
          user.walletBalance,
          user.wallet?.balance,
          user.wallet_amount,
          stored?.walletBalance,
        );
        const dynamicRating = pickNumber(
          user.rating,
          user.avgRating,
          user.average_rating,
          stored?.rating,
          4.9,
        );
        const dynamicLoyaltyPoints = pickNumber(
          walletData.referralWallet,
          walletData.availableReferralWallet,
          user.loyaltyPoints,
          user.loyalty_points,
          stored?.loyaltyPoints,
          0,
        );
        const dynamicReferralWallet = pickNumber(
          walletData.referralWallet,
          stored?.referralWallet,
          0,
        );
        const dynamicLockedReferralAmount = pickNumber(
          walletData.lockedReferralAmount,
          stored?.lockedReferralAmount,
          0,
        );
        const dynamicAvailableReferralWallet = pickNumber(
          walletData.availableReferralWallet,
          dynamicReferralWallet - dynamicLockedReferralAmount,
          stored?.availableReferralWallet,
          0,
        );
        const dynamicMinimumRedeemAmount = pickNumber(
          walletData.referralProgram?.minimumRedeemAmount,
          stored?.minimumRedeemAmount,
          100,
        );
        
        setProfile({
          name: user.name || stored?.name || 'User',
          phone: user.phone || stored?.phone || '',
          profileImage: user.profileImage || user.profile_image || stored?.profileImage || '',
          loyaltyPoints: dynamicLoyaltyPoints,
          referralWallet: dynamicReferralWallet,
          lockedReferralAmount: dynamicLockedReferralAmount,
          availableReferralWallet: dynamicAvailableReferralWallet,
          minimumRedeemAmount: dynamicMinimumRedeemAmount,
          stats: {
            trips: dynamicTripCount,
            rating: dynamicRating,
            wallet: dynamicWalletBalance,
          }
        });
        localStorage.setItem('userInfo', JSON.stringify({
          ...stored,
          ...user,
          walletBalance: dynamicWalletBalance,
          totalRides: dynamicTripCount,
          rating: dynamicRating,
          loyaltyPoints: dynamicLoyaltyPoints,
          referralWallet: dynamicReferralWallet,
          lockedReferralAmount: dynamicLockedReferralAmount,
          availableReferralWallet: dynamicAvailableReferralWallet,
          minimumRedeemAmount: dynamicMinimumRedeemAmount,
        }));
      } catch (err) {
        console.error('Failed to load profile', err);
      }
    };

    loadProfile();
  }, [navigate]);

  const handleLogout = () => {
    clearCurrentRide();
    socketService.disconnect();
    clearLocalUserSession();
    navigate('/taxi/user/login', { replace: true });
  };

  const initials = (profile.name || 'User')
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() || '')
    .join('');

  const safeAvailableReferralWallet = Math.max(0, Number(profile.availableReferralWallet || 0));
  const safeMinimumRedeemAmount = Math.max(1, Number(profile.minimumRedeemAmount || 100));
  const referralProgress = Math.min(100, Math.round((safeAvailableReferralWallet / safeMinimumRedeemAmount) * 100));
  const referralShortfall = Math.max(0, safeMinimumRedeemAmount - safeAvailableReferralWallet);

  const containerVariants = {
    hidden: { opacity: 0 },
    visible: {
      opacity: 1,
      transition: {
        staggerChildren: 0.1
      }
    }
  };

  const itemVariants = {
    hidden: { opacity: 0, y: 20 },
    visible: { 
      opacity: 1, 
      y: 0,
      transition: { duration: 0.5, ease: [0.22, 1, 0.36, 1] }
    }
  };

  return (
    <div className="min-h-screen bg-[#FBFBF6] max-w-lg mx-auto pb-28 relative overflow-x-hidden">
      {/* Premium Header Background */}
      <div className="absolute top-0 inset-x-0 h-80 bg-[#2F5F43] overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-[#6FBF7A]/30 via-[#2F5F43] to-[#1a3d2a]" />
        <div className="absolute top-[-20%] right-[-10%] h-64 w-64 bg-[#6FBF7A]/15 rounded-full blur-3xl" />
        <div className="absolute top-[40%] left-[-8%] h-48 w-48 bg-[#F2D34F]/10 rounded-full blur-3xl" />
        <div className="absolute bottom-0 left-[-5%] h-40 w-40 bg-[#6FBF7A]/10 rounded-full blur-2xl" />
      </div>

      <div className="relative z-10">
        {/* Header Section */}
        <div className="px-6 pt-12 pb-8">
          <div className="flex items-center justify-between mb-8">
            <h1 className="text-2xl font-extrabold text-white tracking-tight">Profile</h1>
            <MotionButton
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              onClick={() => navigate('/taxi/user/profile/settings')}
              className="h-10 w-10 rounded-xl bg-white/10 backdrop-blur-md border border-white/10 flex items-center justify-center text-white"
            >
              <Settings size={20} />
            </MotionButton>
          </div>

          {/* Profile Hero Card */}
          <MotionDiv
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="rounded-[28px] bg-white p-6 shadow-[0_20px_60px_rgba(47,95,67,0.12)] border border-[#E8F3E9]"
          >
            <div className="flex items-center gap-5">
              <div className="relative">
                <div className="w-20 h-20 rounded-[28px] bg-[#2F5F43] flex items-center justify-center shadow-lg overflow-hidden border-2 border-white">
                  {profile.profileImage ? (
                    <img 
                      src={profile.profileImage} 
                      alt="User" 
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <span className="text-2xl font-black text-white opacity-40">{initials || 'U'}</span>
                  )}
                </div>
                <div className="absolute -bottom-1 -right-1 w-6 h-6 bg-[#6FBF7A] rounded-lg border-2 border-white flex items-center justify-center shadow-sm">
                  <Check size={14} className="text-white" strokeWidth={4} />
                </div>
              </div>
              <div className="flex-1 min-w-0">
                <h2 className="text-[22px] font-extrabold text-[#1F2937] truncate capitalize leading-tight">
                  {profile.name}
                </h2>
                <p className="text-[14px] font-bold text-slate-400 mt-1 flex items-center gap-1.5">
                   <Phone size={14} className="text-slate-300" />
                   {profile.phone ? `+91 ${profile.phone}` : 'Account Active'}
                </p>
              </div>
            </div>

            {/* Quick Stats Row */}
            <div className="grid grid-cols-3 gap-3 mt-8 pt-6 border-t border-slate-50">
              <div className="text-center">
                 <p className="text-[10px] font-black uppercase tracking-[0.15em] text-slate-300">Total Trips</p>
                 <p className="text-[18px] font-extrabold text-[#2F5F43] mt-1">{profile.stats.trips}</p>
              </div>
              <div className="text-center border-x border-slate-50">
                <p className="text-[10px] font-black uppercase tracking-[0.15em] text-slate-300">Rating</p>
                <div className="flex items-center justify-center gap-1 mt-1">
                  <Star size={14} className="text-amber-400 fill-amber-400" />
                  <p className="text-[18px] font-extrabold text-[#1F2937]">{profile.stats.rating}</p>
                </div>
              </div>
              <div className="text-center">
                <p className="text-[10px] font-black uppercase tracking-[0.15em] text-slate-300">Credits</p>
                 <p className="text-[18px] font-extrabold text-[#6FBF7A] mt-1">₹{profile.stats.wallet}</p>
              </div>
            </div>
          </MotionDiv>
        </div>

        {/* Menu Sections */}
        <motion.div 
          variants={containerVariants}
          initial="hidden"
          animate="visible"
          className="px-6 space-y-8"
        >
          {/* Loyalty Club Premium Widget */}
          <motion.div variants={itemVariants} className="space-y-4">
            <h3 className="font-sans text-[12px] font-black text-slate-400 uppercase tracking-[0.25em] ml-1">
              Loyalty Club
            </h3>
            
            <div className="relative overflow-hidden rounded-[28px] bg-gradient-to-br from-[#2F5F43] via-[#3a7050] to-[#2F5F43] p-6 text-white shadow-xl shadow-[#2F5F43]/25">
              {/* Decorative elements */}
              <div className="absolute top-[-20%] right-[-10%] h-32 w-32 bg-white/10 rounded-full blur-xl" />
              <div className="absolute bottom-[-20%] left-[-10%] h-24 w-24 bg-white/5 rounded-full blur-lg" />
              
              <div className="relative z-10 flex items-center justify-between gap-4">
                <div className="flex items-center gap-4">
                  <div className="w-14 h-14 rounded-2xl bg-white/20 backdrop-blur-md border border-white/20 flex items-center justify-center shrink-0">
                    <Award size={28} className="text-white" strokeWidth={2.5} />
                  </div>
                  <div>
                    <p className="text-[12px] font-bold tracking-wider text-[#CFE8C9] uppercase opacity-90">Referral Wallet</p>
                    <h4 className="text-[26px] font-extrabold tracking-tight mt-0.5">
                      ₹{safeAvailableReferralWallet.toFixed(0)} <span className="text-sm font-bold text-emerald-100">Available</span>
                    </h4>
                    <p className="mt-1 text-[11px] font-semibold text-emerald-100/90">
                      Total ₹{Number(profile.referralWallet || 0).toFixed(0)}
                      {Number(profile.lockedReferralAmount || 0) > 0 ? ` • Locked ₹${Number(profile.lockedReferralAmount || 0).toFixed(0)}` : ''}
                    </p>
                  </div>
                </div>
                
                <MotionButton
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.95 }}
                  onClick={() => navigate('/taxi/user/wallet')}
                  className="px-4 py-2 rounded-xl bg-white text-[#2F5F43] font-extrabold text-[13px] shadow-md hover:bg-[#EFF8F0] transition-all"
                >
                  Redeem
                </MotionButton>
              </div>

              {/* Progress bar info */}
              <div className="relative z-10 mt-6 pt-5 border-t border-white/10">
                <div className="flex justify-between items-center text-[12px] font-semibold text-white/90">
                  <span className="flex items-center gap-1">
                    <Sparkles size={12} className="text-emerald-200 fill-emerald-200 animate-pulse" />
                    {referralShortfall > 0
                      ? `₹${referralShortfall.toFixed(0)} to minimum redeem`
                      : 'Ready to redeem'}
                  </span>
                  <span>{referralProgress}% complete</span>
                </div>
                <div className="w-full h-2 bg-white/20 rounded-full mt-2.5 overflow-hidden">
                  <div className="h-full bg-white rounded-full" style={{ width: `${referralProgress}%` }} />
                </div>
              </div>
            </div>
          </motion.div>

          {menuSections.map((section, sIdx) => (
            <motion.div key={sIdx} variants={itemVariants} className="space-y-4">
              <h3 className="font-sans text-[12px] font-black text-slate-400 uppercase tracking-[0.25em] ml-1">
                {section.title}
              </h3>
              
              <div className="bg-white rounded-[32px] border border-slate-100 shadow-premium overflow-hidden divide-y divide-slate-50">
                {section.items.map((item, iIdx) => (
                  <MotionButton
                    key={iIdx}
                    whileTap={{ backgroundColor: '#F8FAFC' }}
                    onClick={() => navigate(item.path)}
                    className="w-full flex items-center gap-5 px-6 py-5 text-left transition-colors"
                  >
                    <div className={`w-11 h-11 rounded-[16px] flex items-center justify-center shrink-0 ${item.bg}`}>
                      <item.icon size={20} className={item.color} strokeWidth={2.5} />
                    </div>
                    <div className="flex-1">
                      <p className="text-[15px] font-bold text-slate-900 leading-tight tracking-tight">{item.title}</p>
                      <p className="text-[12px] font-semibold text-slate-400 mt-1 opacity-80">{item.sub}</p>
                    </div>
                    <div className="h-8 w-8 rounded-full bg-slate-50 flex items-center justify-center text-slate-200">
                      <ChevronRight size={18} strokeWidth={3} />
                    </div>
                  </MotionButton>
                ))}
              </div>
            </motion.div>
          ))}

          {/* Dangerous Zone */}
          <motion.div variants={itemVariants} className="pt-4 pb-12 space-y-4">
             <MotionButton
              whileHover={{ scale: 1.01 }}
              whileTap={{ scale: 0.98 }}
              onClick={() => navigate('/taxi/user/profile/delete-account')}
              className="w-full flex items-center gap-4 px-6 py-4 rounded-[24px] border border-red-50 text-red-500 hover:bg-red-50 transition-colors"
            >
              <div className="w-10 h-10 rounded-xl bg-red-50 flex items-center justify-center shrink-0">
                <Trash2 size={18} strokeWidth={2.5} />
              </div>
              <p className="text-[14px] font-bold">Delete account</p>
            </MotionButton>

            <MotionButton
              whileHover={{ scale: 1.01 }}
              whileTap={{ scale: 0.98 }}
              onClick={handleLogout}
              className="w-full h-16 rounded-[24px] bg-slate-900 text-white flex items-center justify-center gap-3 text-[15px] font-black shadow-xl shadow-slate-900/10"
            >
              <LogOut size={18} strokeWidth={3} />
              Sign Out Securely
            </MotionButton>

            <div className="text-center pt-6">
              <p className="text-[10px] font-black text-slate-300 uppercase tracking-[0.3em]">
                Version 2.4.1 • Built with Love
              </p>
            </div>
          </motion.div>
        </motion.div>
      </div>

      <BottomNavbar />
    </div>
  );0
};
 
export default Profile;
