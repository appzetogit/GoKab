import React, { useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ArrowLeft,
  Flame,
  Gift,
  Loader2,
  Star,
  Trophy,
  Zap,
  Lock,
  CheckCircle2,
  ChevronRight,
  Shield,
  Sparkles,
  X,
  Copy,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import DriverBottomNav from '../../shared/components/DriverBottomNav';
import { claimDriverIncentiveReward, getCurrentDriver, getDriverIncentives } from '../services/registrationService';

// Custom flat cartoon illustrations matching the user's green/black vector style
import incentivesBanner from '../../../assets/incentives_banner.png';
import bikeWashImg from '../../../assets/bike_wash.png';
import bikeServiceImg from '../../../assets/bike_service.png';
import freeHelmetImg from '../../../assets/free_helmet.png';

const unwrap = (response) => response?.data?.data || response?.data || response || {};

const FEATURE_ICONS = {
  daily_active_streak: Flame,
  weekly_trip_quest: Trophy,
  peak_hour_booster: Zap,
  weekend_warrior: Shield,
  rating_guard: Star,
  cancellation_guard: CheckCircle2,
};

const formatCurrency = (value) => `₹${Number(value || 0).toLocaleString('en-IN')}`;

const progressPercent = (current, target) => {
  const safeTarget = Math.max(1, Number(target || 0));
  const safeCurrent = Math.max(0, Number(current || 0));
  return Math.min(100, Math.round((safeCurrent / safeTarget) * 100));
};

const DriverIncentives = () => {
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [claimingKey, setClaimingKey] = useState('');
  const [driverRating, setDriverRating] = useState(0);
  
  // State for benefit detail modal
  const [selectedBenefit, setSelectedBenefit] = useState(null);

  const fetchIncentives = async ({ quiet = false } = {}) => {
    if (!quiet) setLoading(true);
    setError('');

    try {
      const [incentiveResponse, driverResponse] = await Promise.all([
        getDriverIncentives(),
        getCurrentDriver(),
      ]);
      setData(unwrap(incentiveResponse));
      setDriverRating(Number(unwrap(driverResponse)?.rating || 0));
    } catch (requestError) {
      setError(requestError?.response?.data?.message || requestError?.message || 'Unable to load milestone progress');
    } finally {
      if (!quiet) setLoading(false);
    }
  };

  useEffect(() => {
    fetchIncentives();
  }, []);

  const handleClaim = async (rewardType, rewardKey) => {
    setClaimingKey(`${rewardType}:${rewardKey}`);
    try {
      const response = await claimDriverIncentiveReward({ rewardType, rewardKey });
      const claimedReward = unwrap(response)?.claimedReward;
      toast.success(`${formatCurrency(claimedReward?.amount || 0)} added to your wallet!`);
      await fetchIncentives({ quiet: true });
    } catch (requestError) {
      toast.error(requestError?.response?.data?.message || requestError?.message || 'Unable to claim reward');
    } finally {
      setClaimingKey('');
    }
  };

  const summary = useMemo(() => data?.summary || {}, [data]);
  const milestones = useMemo(() => data?.milestones || [], [data]);
  const features = useMemo(() => data?.features || [], [data]);
  const enabledFeatures = useMemo(() => features.filter((item) => item.enabled), [features]);
  const claimedRewards = useMemo(() => data?.claimedRewards || [], [data]);
  const bonusEarnings = useMemo(
    () => claimedRewards.reduce((sum, item) => sum + Number(item?.amount || 0), 0),
    [claimedRewards],
  );

  // Level & Tier System
  const levelData = useMemo(() => {
    const totalTrips = Number(summary.totalTrips || summary.currentWeekTrips || 0);
    const level = Math.floor(totalTrips / 50) + 1;
    const currentXP = totalTrips % 50;
    const targetXP = 50;
    
    const levels = [
      { name: 'Bronze', color: '#B45309', themeGradient: 'from-amber-600 to-amber-900', text: 'text-amber-800' },
      { name: 'Silver', color: '#475569', themeGradient: 'from-slate-500 to-slate-800', text: 'text-slate-700' },
      { name: 'Gold', color: '#CA8A04', themeGradient: 'from-yellow-600 via-amber-600 to-amber-900', text: 'text-yellow-800' },
      { name: 'Platinum', color: '#4F46E5', themeGradient: 'from-indigo-600 via-violet-600 to-slate-900', text: 'text-indigo-800' },
    ];
    
    const matched = levels[Math.min(level - 1, levels.length - 1)];
    return {
      level,
      percent: (currentXP / targetXP) * 100,
      currentXP,
      targetXP,
      ...matched
    };
  }, [summary]);

  // Determine active/locked milestones sequentially
  const processedMilestones = useMemo(() => {
    const firstUnclaimedIndex = milestones.findIndex(m => !m.isClaimed);
    return milestones.map((m, idx) => {
      let status = 'locked'; // 'claimed', 'active', 'locked'
      if (m.isClaimed) {
        status = 'claimed';
      } else if (idx === firstUnclaimedIndex) {
        status = 'active';
      }
      return {
        ...m,
        roadmapStatus: status,
      };
    });
  }, [milestones]);

  // Calculate dynamic driver active days for progress tracking
  const driverActiveDays = useMemo(() => {
    const milestoneDays = milestones[0]?.progress?.qualifyingDays;
    return typeof milestoneDays === 'number' ? milestoneDays : 24;
  }, [milestones]);

  // 1-Month Completion Perks (30 active days target)
  const oneMonthPerks = useMemo(() => {
    const config = [
      {
        id: 'service',
        title: 'FREE BIKE SERVICE',
        sub: '₹350 Value • Full Tuning',
        valid: 'Valid for 30 days',
        code: 'FREEBIKESVC',
        image: bikeServiceImg,
        instructions: [
          'Present the code FREEBIKESVC at any GoKab Partner Service Station.',
          'Get a comprehensive general servicing (worth ₹350) completely free.',
          'Includes filter cleaning, brake adjustment, and multi-point checkup.'
        ]
      },
      {
        id: 'care',
        title: '6 MONTHS BIKE CARE',
        sub: 'Basic Maintenance Cover',
        valid: 'Valid for 6 months',
        code: 'BIKECARE6M',
        image: bikeWashImg, // Wash image works nicely for care
        instructions: [
          'Use the coupon code BIKECARE6M to activate your 6 Months Bike Care package.',
          'Provides monthly checkups: engine oil levels, tyre pressure, chain adjustments.',
          'Present the code FREEBIKESVC at any GoKab Partner Service Station.',
        ],
      },
      {
        id: '2',
        title: 'Safety Gear Kit',
        reward: 'High-Vis Jacket + Helmet',
        status: 'Locked',
        progress: 60,
        total: 100,
        expiry: '15 Days Left',
        description: 'Complete 100 rides with a 4.8+ rating to claim your official driver kit.',
        claimInstructions: [
          'Visit your nearest GoKab Driver Hub.',
          'Show coupon code FREEHELMET to the hub coordinator.',
          'Collect your brand-new ISI-certified safety helmet completely free.'
        ]
      }
    ];

    const isCompleted = driverActiveDays >= 30;
    const progress = Math.min(100, Math.round((driverActiveDays / 30) * 100));
    const daysRemaining = Math.max(0, 30 - driverActiveDays);

    return config.map((perk) => ({
      ...perk,
      status: isCompleted ? 'completed' : 'active',
      progress,
      daysRemaining
    }));
  }, [driverActiveDays]);

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50/50 flex flex-col items-center justify-center">
        <Loader2 className="animate-spin text-emerald-600" size={32} />
        <p className="mt-4 text-xs font-semibold text-gray-400 uppercase tracking-widest">Loading Milestones</p>
      </div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 15 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: 'easeOut' }}
      className="min-h-screen bg-slate-50/30 font-sans pb-32"
    >
      {/* Premium Navigation Header */}
      <header className="sticky top-0 z-30 bg-white/95 backdrop-blur-md px-5 pt-8 pb-5 border-b border-slate-100 shadow-sm flex items-center justify-between">
        <div className="flex items-center gap-3">
          <motion.button
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            type="button"
            onClick={() => navigate('/taxi/driver/profile')}
            className="flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200/60 bg-white shadow-sm hover:bg-slate-50 transition-colors"
            aria-label="Back to account"
          >
            <ArrowLeft size={16} className="text-slate-700" />
          </motion.button>
          <div>
            <h1 className="text-lg font-black text-slate-900 tracking-tight">Milestones</h1>
            <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mt-0.5">Incentives & Tier Benefits</p>
          </div>
        </div>
        <div className="text-right bg-slate-50 border border-slate-100 rounded-xl px-3.5 py-1.5">
          <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">Bonus Earned</p>
          <p className="text-base font-extrabold text-emerald-600">{formatCurrency(bonusEarnings)}</p>
        </div>
      </header>

      {error && (
        <div className="mx-5 mt-4 p-4 bg-rose-50 border border-rose-100 text-rose-700 rounded-2xl text-xs font-semibold">
          {error}
        </div>
      )}

      <main className="px-5 pt-5 space-y-6 max-w-lg mx-auto">
        
        {/* Top 3-Col Stats Row */}
        <section className="grid grid-cols-3 gap-3">
          <motion.div
            whileHover={{ scale: 1.02, y: -2 }}
            whileTap={{ scale: 0.98 }}
            className="bg-white border border-slate-100 rounded-2xl p-3 text-center shadow-soft flex flex-col justify-between"
          >
            <div className="flex items-center justify-center gap-1 text-[9px] font-black text-slate-400 uppercase tracking-wider">
              <span>STREAK</span>
              <motion.div
                animate={{ scale: [1, 1.15, 1] }}
                transition={{ repeat: Infinity, duration: 1.5 }}
              >
                <Flame size={12} className="text-orange-500 fill-orange-100" />
              </motion.div>
            </div>
            <p className="text-base font-black text-slate-900 mt-1.5">{summary.streakDays || 0} Days</p>
            <p className="text-[8px] text-slate-400 mt-1 font-bold">Keep it up!</p>
          </motion.div>
          
          <motion.div
            whileHover={{ scale: 1.02, y: -2 }}
            whileTap={{ scale: 0.98 }}
            className="bg-white border border-slate-100 rounded-2xl p-3 text-center shadow-soft flex flex-col justify-between"
          >
            <div className="flex items-center justify-center gap-1 text-[9px] font-black text-slate-400 uppercase tracking-wider">
              <span>WEEKLY TRIPS</span>
            </div>
            <p className="text-base font-black text-slate-900 mt-1.5">{summary.currentWeekTrips || 0} Rides</p>
            <p className="text-[8px] text-slate-400 mt-1 font-bold">More rewards</p>
          </motion.div>
          
          <motion.div
            whileHover={{ scale: 1.02, y: -2 }}
            whileTap={{ scale: 0.98 }}
            className="bg-white border border-slate-100 rounded-2xl p-3 text-center shadow-soft flex flex-col justify-between"
          >
            <div className="flex items-center justify-center gap-1 text-[9px] font-black text-slate-400 uppercase tracking-wider">
              <span>RATING</span>
              <Star size={11} className="text-yellow-500 fill-yellow-500 animate-pulse" />
            </div>
            <p className="text-base font-black text-slate-900 mt-1.5">{driverRating.toFixed(1)}</p>
            <p className="text-[8px] text-slate-400 mt-1 font-bold">Your rating</p>
          </motion.div>
        </section>

        {/* Driver Benefits Premium Card */}
        <section className="bg-gradient-to-br from-slate-950 via-slate-900 to-emerald-950 rounded-3xl border border-slate-800 shadow-xl overflow-hidden relative text-white">
          <div className="p-6 relative z-10 flex justify-between items-center">
            <div className="space-y-4 max-w-[65%]">
              <div>
                <h3 className="text-[10px] font-black uppercase tracking-widest text-emerald-400">Driver Benefits</h3>
                <p className="text-3xl font-black tracking-tight mt-1">{formatCurrency(bonusEarnings)}</p>
                <p className="text-[9px] text-slate-400 font-bold uppercase tracking-wider mt-0.5">Saved This Month</p>
              </div>
              
              <div className="flex flex-wrap items-center gap-2">
                <div className="flex items-center gap-1.5 bg-emerald-900/40 border border-emerald-800/60 rounded-full px-2.5 py-1">
                  <Gift size={10} className="text-emerald-400" />
                  <span className="text-[9px] font-bold text-emerald-200">{enabledFeatures.length} Active Perks</span>
                </div>
                
                <div className="flex items-center gap-1.5 bg-amber-900/40 border border-amber-800/60 rounded-full px-2.5 py-1">
                  <Trophy size={10} className="text-amber-400" />
                  <span className="text-[9px] font-bold text-amber-200">{levelData.name} Tier</span>
                </div>
              </div>
            </div>
            
            {/* Animated Floating 3D Trophy Banner */}
            <motion.div
              animate={{ y: [0, -6, 0] }}
              transition={{ repeat: Infinity, duration: 3, ease: 'easeInOut' }}
              className="relative shrink-0 pr-2"
            >
              <img 
                src={incentivesBanner} 
                alt="Gold Trophy Achievement" 
                className="w-24 h-24 object-contain drop-shadow-[0_10px_20px_rgba(16,185,129,0.35)]" 
              />
            </motion.div>
          </div>
          
          {/* Animated level banner */}
          <div className="bg-gradient-to-r from-emerald-600 to-teal-700 px-6 py-2 flex items-center justify-between text-white border-t border-emerald-900/30">
            <span className="text-[9px] font-black uppercase tracking-widest">{levelData.name} Driver</span>
            <div className="flex items-center gap-1">
              <span className="text-[8px] font-bold text-emerald-100">LEVEL {levelData.level} BENEFITS</span>
              <ChevronRight size={10} />
            </div>
          </div>
        </section>

        {/* Milestone Roadmap */}
        <section className="space-y-4">
          <div className="flex justify-between items-center px-1">
            <h3 className="text-xs font-black text-slate-800 uppercase tracking-widest">Milestone Roadmap</h3>
            <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Weekly Consistency</span>
          </div>

          <div className="space-y-4">
            {processedMilestones.length === 0 ? (
              <div className="text-center py-8 text-xs text-slate-400 font-bold bg-white rounded-3xl border border-slate-100">
                No active milestones configured.
              </div>
            ) : (
              processedMilestones.map((milestone, idx) => {
                const isClaimed = milestone.roadmapStatus === 'claimed';
                const isActive = milestone.roadmapStatus === 'active';
                const isLocked = milestone.roadmapStatus === 'locked';
                const canClaim = milestone.isEligible && !milestone.isClaimed;
                const progress = progressPercent(milestone.progress?.qualifyingDays, milestone.progress?.targetDays);

                return (
                  <div key={milestone.id || idx} className="flex gap-4 items-stretch relative">
                    
                    {/* Timeline bullet design */}
                    <div className="flex flex-col items-center relative">
                      {isActive ? (
                        <motion.div
                          animate={{ scale: [1, 1.08, 1] }}
                          transition={{ repeat: Infinity, duration: 2 }}
                          className="z-10 flex h-8 w-8 items-center justify-center rounded-full border text-xs font-black shadow-sm bg-white border-emerald-500 text-emerald-600 ring-2 ring-emerald-100"
                        >
                          {idx + 1}
                        </motion.div>
                      ) : (
                        <div className={`z-10 flex h-8 w-8 items-center justify-center rounded-full border text-xs font-black shadow-sm transition-all duration-300 ${
                          isClaimed
                            ? 'bg-emerald-600 border-emerald-600 text-white'
                            : 'bg-slate-100 border-slate-200 text-slate-400'
                        }`}>
                          {isClaimed ? <CheckCircle2 size={16} /> : <Lock size={12} />}
                        </div>
                      )}
                      
                      {idx < processedMilestones.length - 1 && (
                        <div className={`w-0.5 flex-1 absolute top-8 bottom-0 -mb-4 ${
                          isClaimed
                            ? 'bg-emerald-500'
                            : isActive
                            ? 'border-l-2 border-dashed border-emerald-400'
                            : 'border-l-2 border-dashed border-slate-200'
                        }`} />
                      )}
                    </div>

                    {/* Timeline Card */}
                    <motion.div 
                      whileHover={!isLocked ? { scale: 1.01 } : {}}
                      className={`flex-1 rounded-3xl p-5 bg-white border shadow-soft transition-all duration-300 ${
                        isActive ? 'border-emerald-200 ring-1 ring-emerald-50/30' : 'border-slate-100'
                      }`}
                    >
                      <div className="flex justify-between items-start gap-3">
                        <div>
                          <h4 className={`text-sm font-extrabold ${isLocked ? 'text-slate-400' : 'text-slate-900'}`}>
                            {milestone.name || `${idx + 1}st milestone`}
                          </h4>
                          <p className="text-[9px] font-bold text-slate-400 mt-0.5 uppercase tracking-wider">
                            {milestone.required_weeks} Weeks Consistency Challenge
                          </p>
                        </div>
                        <div className="text-right shrink-0">
                          <p className="text-[8px] font-black text-slate-400 uppercase tracking-widest">Payout</p>
                          <p className={`text-sm font-black ${isLocked ? 'text-slate-400' : 'text-emerald-600'}`}>
                            {formatCurrency(milestone.payout_amount)}
                          </p>
                        </div>
                      </div>

                      {/* Progress bar */}
                      {!isLocked && (
                        <div className="space-y-1.5 mt-4">
                          <div className="flex justify-between text-[10px] font-bold">
                            <span className="text-slate-400">Progress Tracker</span>
                            <span className="text-slate-800">
                              {milestone.progress?.qualifyingDays || 0}/{milestone.progress?.targetDays || 0} active days
                            </span>
                          </div>
                          
                          <div className="h-2 w-full bg-slate-100 rounded-full overflow-hidden">
                            <motion.div 
                              initial={{ width: 0 }}
                              animate={{ width: `${progress}%` }} 
                              transition={{ duration: 0.8, ease: 'easeOut' }}
                              className="h-full rounded-full bg-emerald-500" 
                            />
                          </div>
                        </div>
                      )}

                      {isLocked && (
                        <p className="text-xs text-slate-400/80 mt-2 flex items-center gap-1.5 font-medium">
                          <Lock size={11} /> Complete previous milestone to unlock
                        </p>
                      )}

                      {/* Payout claim button */}
                      {canClaim && (
                        <motion.button
                          whileHover={{ scale: 1.02 }}
                          whileTap={{ scale: 0.98 }}
                          animate={{ boxShadow: ["0 0 0 rgba(16,185,129,0.3)", "0 0 12px rgba(16,185,129,0.7)", "0 0 0 rgba(16,185,129,0.3)"] }}
                          transition={{ repeat: Infinity, duration: 1.5 }}
                          type="button"
                          disabled={claimingKey === `milestone:${milestone.id}`}
                          onClick={() => handleClaim('milestone', milestone.id)}
                          className="mt-4 w-full py-2.5 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-xs font-black uppercase tracking-wider transition-all shadow-sm flex items-center justify-center gap-1.5"
                        >
                          {claimingKey === `milestone:${milestone.id}` ? (
                            <>
                              <Loader2 className="animate-spin" size={14} />
                              <span>Claiming...</span>
                            </>
                          ) : (
                            <>
                              <Sparkles size={13} className="text-amber-300 animate-pulse" />
                              <span>Claim Payout {formatCurrency(milestone.payout_amount)}</span>
                            </>
                          )}
                        </motion.button>
                      )}

                      {isClaimed && (
                        <div className="mt-3 inline-flex items-center gap-1.5 bg-emerald-50 border border-emerald-100 rounded-lg px-2.5 py-1 text-[9px] font-bold text-emerald-700">
                          <CheckCircle2 size={11} /> Claimed & Wallet Credited
                        </div>
                      )}
                    </motion.div>
                  </div>
                );
              })
            )}
          </div>
        </section>

        {/* 1 Mahina Complete Hone Par - Perks */}
        <section className="space-y-4">
          <div className="flex justify-between items-center px-1">
            <h3 className="text-xs font-black text-slate-800 uppercase tracking-widest">1-Month Milestone</h3>
            <span className="text-[10px] font-black text-emerald-600 uppercase tracking-widest flex items-center gap-1 animate-pulse">
              <Sparkles size={11} className="text-emerald-500 fill-emerald-500" />
              Special Perks Pack
            </span>
          </div>

          {/* Stepper Timeline Header Card */}
          <div className="bg-gradient-to-br from-slate-900 to-slate-950 text-white rounded-3xl p-6 border border-slate-800 shadow-md space-y-4 relative overflow-hidden">
            <div className="flex justify-between items-start relative z-10">
              <div>
                <h4 className="text-xl font-black tracking-tight text-white uppercase">1 Mahina Complete Hone Par</h4>
                <p className="text-xs font-extrabold text-emerald-400 mt-1 uppercase tracking-wider">Extra Fayda (No Extra Paisa)</p>
                <p className="text-[11px] text-slate-300 mt-2 font-medium">
                  Complete 30 active days to unlock all premium safety and service rewards instantly.
                </p>
              </div>
              <div className="text-right bg-emerald-950/60 border border-emerald-800/40 rounded-2xl px-3.5 py-2 shrink-0 shadow-sm">
                <span className="text-[8px] font-black text-emerald-400 uppercase tracking-wider block">COMPLETED DAYS</span>
                <span className="text-base font-black text-white">{driverActiveDays}/30 Days</span>
              </div>
            </div>

            {/* Stepper Progress Bar */}
            <div className="relative pt-2 pb-1 z-10">
              <div className="h-2 w-full bg-slate-800 rounded-full overflow-hidden">
                <motion.div
                  initial={{ width: 0 }}
                  animate={{ width: `${Math.min(100, (driverActiveDays / 30) * 100)}%` }}
                  transition={{ duration: 1, ease: 'easeOut' }}
                  className="h-full rounded-full bg-gradient-to-r from-emerald-500 via-teal-400 to-emerald-400"
                />
              </div>
              <div className="flex justify-between items-center mt-2 text-[10px] font-bold">
                <span className="text-slate-400">
                  {driverActiveDays >= 30 
                    ? '🎉 Target reached! Claim rewards below.' 
                    : `Remaining: ${30 - driverActiveDays} active days`}
                </span>
                <span className="text-emerald-400 uppercase tracking-widest font-black animate-pulse">
                  (Haan Ji, Bilkul Free!)
                </span>
              </div>
            </div>
            
            <Gift className="absolute -right-8 -bottom-8 text-emerald-950/15" size={150} />
          </div>

          {/* Perks list grid */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {oneMonthPerks.map((perk) => {
              const isCompleted = perk.status === 'completed';
              const daysRemaining = perk.daysRemaining;

              return (
                <motion.div
                  whileHover={{ scale: 1.02 }}
                  key={perk.id}
                  className={`bg-white border rounded-3xl p-5 shadow-soft flex flex-col justify-between transition-all duration-300 ${
                    !isCompleted 
                      ? 'border-slate-100 opacity-95' 
                      : 'border-emerald-100 bg-gradient-to-b from-emerald-50/5 to-white ring-1 ring-emerald-500/5'
                  }`}
                >
                  <div className="space-y-4">
                    <div className="flex justify-between items-center">
                      <span className={`text-[8px] font-black uppercase tracking-widest px-2.5 py-1 rounded-full ${
                        isCompleted 
                          ? 'bg-emerald-50 text-emerald-700 border border-emerald-100/50 font-black' 
                          : 'bg-amber-50 text-amber-700 border border-amber-100 font-black'
                      }`}>
                        {isCompleted ? '✓ Unlocked' : '⏳ In Progress'}
                      </span>
                      {isCompleted ? (
                        <CheckCircle2 size={14} className="text-emerald-500" />
                      ) : (
                        <Lock size={12} className="text-amber-500" />
                      )}
                    </div>

                    <div className="h-24 w-full rounded-2xl bg-slate-50/70 flex items-center justify-center border border-slate-100 overflow-hidden relative">
                      <img src={perk.image} alt={perk.title} className={`h-20 w-20 object-contain transition-transform duration-300 ${
                        !isCompleted ? 'grayscale opacity-35' : 'hover:scale-105'
                      }`} />
                      
                      {!isCompleted && (
                        <div className="absolute inset-0 bg-slate-900/5 backdrop-blur-[0.5px] flex items-center justify-center">
                          <div className="h-7 w-7 rounded-full bg-white shadow-sm flex items-center justify-center">
                            <Lock size={12} className="text-slate-400" />
                          </div>
                        </div>
                      )}
                    </div>

                    <div>
                      <h4 className={`text-[9px] font-black uppercase tracking-wider ${
                        !isCompleted ? 'text-slate-400' : 'text-emerald-600'
                      }`}>
                        {perk.title}
                      </h4>
                      <p className="text-xs font-extrabold text-slate-900 mt-1 leading-snug">{perk.sub}</p>
                      <p className="text-[9px] font-bold text-slate-400 mt-1">{perk.valid}</p>
                      
                      {isCompleted && (
                        <p className="text-[9px] font-black text-emerald-700 mt-2.5 uppercase tracking-wider bg-emerald-50 border border-emerald-100 px-2 py-0.5 rounded-lg w-max">
                          Code: {perk.code}
                        </p>
                      )}
                    </div>
                  </div>

                  <div className="mt-5 pt-4 border-t border-slate-100 space-y-2">
                    {!isCompleted && (
                      <p className="text-[9px] font-black text-amber-600 uppercase tracking-wider text-center py-2 bg-amber-50/50 border border-amber-100/40 rounded-xl">
                        🔒 Unlocks in {daysRemaining} days
                      </p>
                    )}

                    {isCompleted && (
                      <motion.button
                        whileTap={{ scale: 0.95 }}
                        type="button"
                        onClick={() => setSelectedBenefit(perk)}
                        className="w-full py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-black uppercase tracking-wider transition-colors shadow-sm"
                      >
                        Claim Reward
                      </motion.button>
                    )}
                  </div>
                </motion.div>
              );
            })}
          </div>
        </section>

        {/* Referral Card Banner */}
        <section className="bg-gradient-to-br from-emerald-800 to-teal-950 rounded-3xl p-6 text-white overflow-hidden relative shadow-md">
          <div className="relative z-10 space-y-4 max-w-[70%]">
            <div>
              <h3 className="text-base font-extrabold tracking-tight">Earn {formatCurrency(data?.referralRewardAmount || 500)} per referral</h3>
              <p className="text-[11px] text-emerald-100/80 leading-relaxed mt-1">
                Invite Fleet Partners and earn rewards instantly when they sign up!
              </p>
            </div>
            <motion.button 
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              onClick={() => navigate('/taxi/driver/referral')}
              className="px-5 py-2.5 bg-white text-emerald-950 rounded-xl text-xs font-black uppercase tracking-widest shadow-sm hover:bg-emerald-50 transition-colors flex items-center gap-1.5"
            >
              <Gift size={12} className="text-emerald-700" />
              <span>Invite Now</span>
            </motion.button>
          </div>
          <Gift className="absolute -right-4 -bottom-4 text-emerald-700/25" size={130} />
        </section>

        {/* Reward Boosters (real backend-configured reward_features) */}
        <section className="space-y-4 pb-8">
          <div className="flex justify-between items-center px-1">
            <h3 className="text-xs font-black text-slate-800 uppercase tracking-widest">Reward Boosters</h3>
            <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Weekly & Daily Perks</span>
          </div>

          {enabledFeatures.length === 0 ? (
            <div className="text-center py-8 text-xs text-slate-400 font-bold bg-white rounded-3xl border border-slate-100">
              No reward boosters configured right now.
            </div>
          ) : (
            <div className="space-y-3">
              {enabledFeatures.map((feature) => {
                const Icon = FEATURE_ICONS[feature.key] || Gift;
                const canClaim = feature.isEligible && !feature.isClaimed;
                const isLowerBetter = feature.key === 'cancellation_guard';
                const progress = isLowerBetter
                  ? Math.max(0, Math.min(100, 100 - progressPercent(feature.currentValue, feature.targetValue)))
                  : progressPercent(feature.currentValue, feature.targetValue);

                return (
                  <div
                    key={feature.key}
                    className={`rounded-3xl p-5 bg-white border shadow-soft transition-all duration-300 ${
                      canClaim ? 'border-emerald-200 ring-1 ring-emerald-50/30' : 'border-slate-100'
                    }`}
                  >
                    <div className="flex justify-between items-start gap-3">
                      <div className="flex items-center gap-3">
                        <div className="h-9 w-9 rounded-xl bg-emerald-50 flex items-center justify-center shrink-0 border border-emerald-100/60">
                          <Icon className="text-emerald-600" size={16} />
                        </div>
                        <div>
                          <h4 className="text-sm font-extrabold text-slate-900">{feature.label}</h4>
                          {feature.description && (
                            <p className="text-[9px] font-bold text-slate-400 mt-0.5">{feature.description}</p>
                          )}
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <p className="text-[8px] font-black text-slate-400 uppercase tracking-widest">Payout</p>
                        <p className="text-sm font-black text-emerald-600">{formatCurrency(feature.reward_amount)}</p>
                      </div>
                    </div>

                    <div className="space-y-1.5 mt-4">
                      <div className="flex justify-between text-[10px] font-bold">
                        <span className="text-slate-400">Progress Tracker</span>
                        <span className="text-slate-800">
                          {feature.currentValue}/{feature.targetValue} {feature.unit || ''}
                        </span>
                      </div>
                      <div className="h-2 w-full bg-slate-100 rounded-full overflow-hidden">
                        <motion.div
                          initial={{ width: 0 }}
                          animate={{ width: `${progress}%` }}
                          transition={{ duration: 0.8, ease: 'easeOut' }}
                          className="h-full rounded-full bg-emerald-500"
                        />
                      </div>
                    </div>

                    {canClaim && (
                      <motion.button
                        whileHover={{ scale: 1.02 }}
                        whileTap={{ scale: 0.98 }}
                        type="button"
                        disabled={claimingKey === `feature:${feature.key}`}
                        onClick={() => handleClaim('feature', feature.key)}
                        className="mt-4 w-full py-2.5 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-xs font-black uppercase tracking-wider transition-all shadow-sm flex items-center justify-center gap-1.5"
                      >
                        {claimingKey === `feature:${feature.key}` ? (
                          <>
                            <Loader2 className="animate-spin" size={14} />
                            <span>Claiming...</span>
                          </>
                        ) : (
                          <>
                            <Sparkles size={13} className="text-amber-300 animate-pulse" />
                            <span>Claim {formatCurrency(feature.reward_amount)}</span>
                          </>
                        )}
                      </motion.button>
                    )}

                    {feature.isClaimed && (
                      <div className="mt-3 inline-flex items-center gap-1.5 bg-emerald-50 border border-emerald-100 rounded-lg px-2.5 py-1 text-[9px] font-bold text-emerald-700">
                        <CheckCircle2 size={11} /> Claimed & Wallet Credited
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </main>

      {/* Dynamic Benefits Detail Modal */}
      <AnimatePresence>
        {selectedBenefit && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            {/* Backdrop opacity fade */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setSelectedBenefit(null)}
              className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            />
            
            {/* Modal scale slide-up */}
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 30 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 30 }}
              transition={{ type: 'spring', damping: 25, stiffness: 350 }}
              className="bg-white w-full max-w-sm rounded-3xl shadow-2xl overflow-hidden border border-slate-100 flex flex-col relative z-10"
            >
              <div className="p-5 border-b border-slate-100 flex justify-between items-center">
                <div className="flex items-center gap-2">
                  <Sparkles size={16} className="text-emerald-500 animate-spin" style={{ animationDuration: '3s' }} />
                  <h3 className="text-sm font-black text-slate-900">Benefit Details</h3>
                </div>
                <motion.button 
                  whileTap={{ scale: 0.9 }}
                  type="button" 
                  onClick={() => setSelectedBenefit(null)}
                  className="h-8 w-8 rounded-full bg-slate-50 border border-slate-200/50 flex items-center justify-center text-slate-400 hover:text-slate-600"
                >
                  <X size={16} />
                </motion.button>
              </div>
              
              <div className="p-6 space-y-5">
                <div className="flex items-center gap-4 bg-slate-50 p-4 rounded-2xl border border-slate-100">
                  <div className="h-16 w-16 rounded-xl bg-white border border-slate-200/60 shadow-sm flex items-center justify-center overflow-hidden shrink-0">
                    <img src={selectedBenefit.image} alt={selectedBenefit.title} className="h-12 w-12 object-contain" />
                  </div>
                  <div>
                    <h4 className="text-[9px] font-black text-emerald-600 uppercase tracking-wider">{selectedBenefit.title}</h4>
                    <p className="text-sm font-black text-slate-900 mt-0.5">{selectedBenefit.sub}</p>
                    <p className="text-[8px] font-bold text-slate-400 mt-0.5">{selectedBenefit.valid}</p>
                  </div>
                </div>

                {/* Interactive Promo Coupon Scratch style */}
                <div className="bg-emerald-50/50 border border-dashed border-emerald-200 rounded-2xl p-4 text-center space-y-2">
                  <p className="text-[8px] font-black text-emerald-600 uppercase tracking-widest">YOUR PROMO CODE</p>
                  <p className="text-xl font-black text-emerald-950 uppercase tracking-widest select-all select-none bg-white py-1 px-4 border border-emerald-100 rounded-xl inline-block shadow-sm">
                    {selectedBenefit.code}
                  </p>
                  <div>
                    <motion.button
                      whileTap={{ scale: 0.95 }}
                      type="button"
                      onClick={() => {
                        navigator.clipboard.writeText(selectedBenefit.code);
                        toast.success('Coupon code copied to clipboard!');
                      }}
                      className="inline-flex items-center gap-1.5 text-[9px] font-black text-emerald-700 bg-emerald-100/50 border border-emerald-200 px-3 py-1 rounded-full uppercase"
                    >
                      <Copy size={10} />
                      <span>Copy Code</span>
                    </motion.button>
                  </div>
                </div>

                {/* Step Instructions */}
                <div className="space-y-2">
                  <p className="text-xs font-black text-slate-800 uppercase tracking-wider">How to redeem:</p>
                  <ol className="list-decimal pl-4 text-xs text-slate-500 space-y-1.5 font-medium leading-relaxed">
                    {selectedBenefit.instructions.map((step, index) => (
                      <li key={index}>{step}</li>
                    ))}
                  </ol>
                </div>
              </div>

              <div className="p-5 bg-slate-50 border-t border-slate-100">
                <motion.button
                  whileTap={{ scale: 0.98 }}
                  type="button"
                  onClick={() => setSelectedBenefit(null)}
                  className="w-full py-3 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-xs font-black uppercase tracking-wider transition-colors shadow-sm"
                >
                  Close Window
                </motion.button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <DriverBottomNav />
    </motion.div>
  );
};

export default DriverIncentives;
