import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import {
  ArrowLeft,
  CheckCircle2,
  Copy,
  Gift,
  Loader2,
  Share2,
  Sparkles,
  RotateCw,
  Info,
  ChevronDown,
  ChevronUp,
  ShieldCheck,
  Coins,
  UserPlus,
  CircleDollarSign,
  AlertTriangle,
} from 'lucide-react';
import BottomNavbar from '../components/BottomNavbar';
import { userAuthService } from '../services/authService';
import {
  getReferralSettingsContent,
  getReferralTranslationContent,
} from '../../shared/services/referralTranslationService';
import {
  applyReferralSettingPlaceholders,
  buildReferralPreviewBlocks,
  getStoredReferralLanguageCode,
  USER_REFERRAL_TRANSLATION_FIELDS,
} from '../../shared/utils/referralTranslationFields';
import { useSettings } from '../../../shared/context/SettingsContext';

const readStoredUserInfo = () => {
  try {
    return JSON.parse(localStorage.getItem('userInfo') || '{}');
  } catch {
    return {};
  }
};

const LEGACY_BRAND_REGEX = /\bzyder\b/gi;

const replaceLegacyReferralBrand = (value, appName) => {
  const safeAppName = String(appName || '').trim() || 'App';
  return String(value || '').replace(LEGACY_BRAND_REGEX, safeAppName);
};

const AccordionItem = ({ id, icon: Icon, title, isExpanded, onToggle, children }) => {
  return (
    <div className="border-b border-gray-100 last:border-0 py-4">
      <button
        type="button"
        onClick={() => onToggle(id)}
        className="w-full flex items-center justify-between text-left focus:outline-none"
      >
        <div className="flex items-center gap-3">
          <div className="text-gray-500">
            <Icon size={18} className="stroke-[1.8]" />
          </div>
          <span className="text-[14px] font-semibold text-gray-800">{title}</span>
        </div>
        <div className="text-gray-400">
          {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
        </div>
      </button>

      <AnimatePresence initial={false}>
        {isExpanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: 'easeInOut' }}
            className="overflow-hidden"
          >
            <div className="pt-3 pl-7 pr-2 space-y-2.5">
              {children}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

const Referral = () => {
  const navigate = useNavigate();
  const { settings } = useSettings();
  const [activeTab, setActiveTab] = useState('refer');
  const [copied, setCopied] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [profile, setProfile] = useState(() => {
    const stored = readStoredUserInfo();
    return {
      referralCode: stored.referralCode || '',
      referralCount: Number(stored.referralCount || 0),
    };
  });
  const [translation, setTranslation] = useState({
    language_code: 'en',
    user_referral: {
      instant_referrer_user: '',
      instant_referrer_user_and_new_user: '',
      conditional_referrer_user_ride_count: '',
      conditional_referrer_user_earnings: '',
      dual_conditional_referrer_user_and_new_user_ride_count: '',
      dual_conditional_referrer_user_and_new_user_earnings: '',
      banner_text: '',
    },
  });

  const [expandedSections, setExpandedSections] = useState({
    rideStandards: true, // Expanded by default matching screenshot
    cashbackRules: false,
    referralRules: false,
    walletRules: false,
    fraudPenalties: false,
  });

  const toggleSection = (section) => {
    setExpandedSections((prev) => ({
      ...prev,
      [section]: !prev[section],
    }));
  };

  const loadReferralPage = async (isManualRefresh = false) => {
    if (isManualRefresh) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }

    const languageCode = getStoredReferralLanguageCode('user');
    const stored = readStoredUserInfo();
    const fallbackUserSection = {
      instant_referrer_user: '',
      instant_referrer_user_and_new_user: '',
      conditional_referrer_user_ride_count: '',
      conditional_referrer_user_earnings: '',
      dual_conditional_referrer_user_and_new_user_ride_count: '',
      dual_conditional_referrer_user_and_new_user_earnings: '',
      banner_text: '',
    };

    try {
      const [userResponse, translationResponse, settingsResponse] = await Promise.all([
        userAuthService.getCurrentUser(),
        getReferralTranslationContent(languageCode),
        getReferralSettingsContent('user'),
      ]);

      const user = userResponse?.data?.user || {};
      const translationData = translationResponse?.data || {};
      const settingsData = settingsResponse?.data || {};
      const hydratedUserReferral = applyReferralSettingPlaceholders(
        translationData.user_referral || fallbackUserSection,
        settingsData,
      );

      setProfile({
        referralCode: user.referralCode || stored.referralCode || '',
        referralCount: Number(user.referralCount || 0),
      });
      setTranslation({
        language_code: translationData.language_code || languageCode,
        user_referral: hydratedUserReferral,
      });

      localStorage.setItem(
        'userInfo',
        JSON.stringify({
          ...stored,
          referralCode: user.referralCode || '',
          referralCount: Number(user.referralCount || 0),
        }),
      );
    } catch {
      try {
        const [translationResponse, settingsResponse] = await Promise.all([
          getReferralTranslationContent(languageCode),
          getReferralSettingsContent('user'),
        ]);
        setTranslation({
          language_code: translationResponse?.data?.language_code || languageCode,
          user_referral: applyReferralSettingPlaceholders(
            translationResponse?.data?.user_referral || fallbackUserSection,
            settingsResponse?.data || {},
          ),
        });
      } catch {
        // Keep local fallback state.
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    loadReferralPage();
  }, []);

  const appName = settings.general?.app_name || 'App';
  const referralCode = profile.referralCode || '';
  const normalizedUserReferral = Object.fromEntries(
    Object.entries(translation.user_referral || {}).map(([key, value]) => [
      key,
      replaceLegacyReferralBrand(value, appName),
    ]),
  );
  const bannerText = normalizedUserReferral.banner_text || `${appName} Refer and Earn`;
  const infoBlocks = buildReferralPreviewBlocks(
    normalizedUserReferral,
    USER_REFERRAL_TRANSLATION_FIELDS,
  );

  const handleCopy = async () => {
    if (!referralCode) {
      return;
    }

    try {
      await navigator.clipboard.writeText(referralCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // Ignore clipboard failures silently.
    }
  };

  const handleShare = async () => {
    if (!referralCode) {
      return;
    }
    const signupLink = `${window.location.origin}/taxi/user/signup?ref=${encodeURIComponent(referralCode)}`;
    const shareText = `${bannerText}\nUse my referral code ${referralCode} to sign up.\n${signupLink}`;

    try {
      if (navigator.share) {
        await navigator.share({
          title: bannerText,
          text: shareText,
        });
        return;
      }
    } catch {
      // Fall through to desktop-friendly sharing options.
    }

    try {
      await navigator.clipboard.writeText(shareText);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // Ignore clipboard failures and continue to WhatsApp fallback.
    }

    window.open(`https://wa.me/?text=${encodeURIComponent(shareText)}`, '_blank');
  };

  const handleWhatsAppShare = () => {
    if (!referralCode) {
      return;
    }
    const signupLink = `${window.location.origin}/taxi/user/signup?ref=${encodeURIComponent(referralCode)}`;
    const shareText = `${bannerText}\nUse my referral code ${referralCode} to sign up.\n${signupLink}`;
    window.open(`https://wa.me/?text=${encodeURIComponent(shareText)}`, '_blank');
  };

  return (
    <div className="min-h-screen bg-[#f8fafc] max-w-lg mx-auto font-sans pb-28">
      {/* Curved Gradient Hero Section */}
      <div className="bg-gradient-to-br from-[#2ebf91] to-[#4076ea] px-5 pt-12 pb-8 rounded-b-[36px] shadow-md relative overflow-hidden">
        {/* Decorative background blur shapes */}
        <div className="absolute top-[-50px] right-[-50px] w-40 h-40 rounded-full bg-white/10 blur-xl pointer-events-none" />
        <div className="absolute bottom-[-30px] left-[-30px] w-32 h-32 rounded-full bg-white/10 blur-xl pointer-events-none" />

        {/* Custom Header Row */}
        <div className="flex items-start justify-between w-full relative z-10">
          <button
            onClick={() => navigate(-1)}
            className="w-10 h-10 flex items-center justify-center text-white rounded-full bg-white/10 hover:bg-white/20 active:scale-95 transition-all shadow-sm"
          >
            <ArrowLeft size={20} />
          </button>
          
          <div className="text-center flex-1 mx-2">
            <div className="flex items-center justify-center gap-1.5 text-white font-bold text-[20px] tracking-wide">
              <span>Rewards & Offers</span>
              <Sparkles size={18} className="text-emerald-100 fill-emerald-100/30 animate-pulse" />
            </div>
            <p className="text-white/80 text-[11px] mt-1.5 font-medium leading-relaxed">
              Track your earnings, referrals, and progress
            </p>
          </div>

          <button
            onClick={() => loadReferralPage(true)}
            disabled={loading || refreshing}
            className="w-10 h-10 flex items-center justify-center text-white rounded-full bg-white/10 hover:bg-white/20 active:scale-95 transition-all disabled:opacity-50 shadow-sm"
          >
            <RotateCw size={18} className={loading || refreshing ? 'animate-spin' : ''} />
          </button>
        </div>

        {/* Faint Outline Box for Referral Code */}
        <div className="mt-8 bg-white/10 backdrop-blur-sm border border-white/20 rounded-[20px] p-4 text-center relative z-10">
          <div className="flex flex-col items-center justify-center">
            <p className="text-white/70 text-[10px] font-semibold uppercase tracking-wider">Your Referral Code</p>
            <div className="flex items-center gap-3 mt-1.5">
              <span className="text-white font-extrabold text-2xl tracking-widest">
                {referralCode || 'NOT AVAILABLE'}
              </span>
              {referralCode && (
                <button
                  type="button"
                  onClick={handleCopy}
                  className="p-1.5 bg-white/10 hover:bg-white/20 active:scale-90 text-white rounded-lg transition-all border border-white/10"
                  title="Copy referral code"
                >
                  {copied ? <CheckCircle2 size={15} className="text-emerald-300" /> : <Copy size={15} />}
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Withdrawal Note text under the box */}
        <p className="text-white/90 text-[11px] text-center font-medium mt-4 relative z-10 leading-relaxed">
          Minimum 5 referrals in first week to unlock withdrawal
        </p>

        {/* WhatsApp & Share Button Row */}
        <div className="flex gap-3 mt-6 relative z-10">
          <button
            type="button"
            onClick={handleWhatsAppShare}
            disabled={!referralCode}
            className="flex-1 rounded-[16px] bg-[#25D366] hover:bg-[#20ba56] text-white py-3.5 font-semibold text-xs flex items-center justify-center gap-2 transition-all shadow-md active:scale-95 disabled:opacity-50"
          >
            {/* Custom SVG WhatsApp Icon */}
            <svg className="w-4.5 h-4.5 fill-current" viewBox="0 0 24 24">
              <path d="M.057 24l1.687-6.163c-1.041-1.804-1.588-3.849-1.587-5.946C.06 5.348 5.397.01 12.008.01c3.202.001 6.212 1.246 8.477 3.513 2.262 2.268 3.507 5.28 3.505 8.484-.004 6.657-5.34 11.997-11.953 11.997-2.005-.001-3.973-.502-5.724-1.455L0 24zm6.09-3.946c1.651.981 3.268 1.488 4.954 1.49 5.48-.003 9.94-4.461 9.943-9.94.002-2.654-1.028-5.148-2.902-7.024C16.27 2.705 13.78 1.673 11.13 1.67c-5.485 0-9.94 4.463-9.943 9.942-.001 1.761.469 3.483 1.361 5.017L1.53 20.316l4.617-1.21c1.558.9 3.242 1.372 4.908 1.372h.001zM16.14 13.1c-.244-.122-1.442-.712-1.666-.793-.223-.08-.387-.122-.55.122-.163.243-.63.793-.772.955-.143.162-.285.182-.528.061-.243-.121-.99-.364-1.884-1.162-.697-.621-1.168-1.388-1.305-1.63-.136-.243-.015-.375.107-.496.11-.11.244-.284.366-.426.121-.142.162-.243.243-.405.082-.162.041-.304-.02-.426-.062-.122-.55-1.32-.753-1.81-.197-.475-.397-.411-.55-.419-.139-.007-.3-.007-.461-.007-.163 0-.427.061-.65.304-.224.243-.854.834-.854 2.031s.874 2.35 1.99 2.5c.117.015 2.166 3.31 5.244 4.636.733.315 1.305.503 1.75.644.737.234 1.408.2 1.939.122.592-.087 1.442-.589 1.646-1.157.203-.568.203-1.055.142-1.157-.061-.101-.223-.162-.466-.284z"/>
            </svg>
            <span>WhatsApp</span>
          </button>

          <button
            type="button"
            onClick={handleShare}
            disabled={!referralCode}
            className="flex-1 rounded-[16px] bg-white/15 hover:bg-white/25 border border-white/20 text-white py-3.5 font-semibold text-xs flex items-center justify-center gap-2 transition-all shadow-md active:scale-95 disabled:opacity-50"
          >
            <Share2 size={16} />
            <span>Share</span>
          </button>
        </div>
      </div>

      {/* Control Tab Bar */}
      <div className="px-5 mt-6">
        <div className="flex bg-gray-100 p-1.5 rounded-2xl shadow-inner">
          <button
            type="button"
            onClick={() => setActiveTab('refer')}
            className={`flex-1 rounded-xl py-3 text-xs font-bold transition-all ${
              activeTab === 'refer'
                ? 'bg-white text-gray-900 shadow-sm border border-gray-200/50'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            Rules & Offers
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('history')}
            className={`flex-1 rounded-xl py-3 text-xs font-bold transition-all ${
              activeTab === 'history'
                ? 'bg-white text-gray-900 shadow-sm border border-gray-200/50'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            Referral History
          </button>
        </div>
      </div>

      {/* Tab Contents */}
      <div className="px-5 mt-6">
        {loading ? (
          <div className="flex items-center justify-center py-20 bg-white rounded-[28px] border border-gray-100 shadow-sm">
            <Loader2 className="animate-spin text-[#2ebf91]" size={28} />
          </div>
        ) : activeTab === 'refer' ? (
          <div className="bg-white rounded-[28px] border border-gray-100 p-5 shadow-sm">
            {/* Header: Info circle + Title */}
            <div className="flex items-center gap-3 border-b border-gray-100 pb-4 mb-2">
              <div className="w-10 h-10 rounded-full bg-blue-50 flex items-center justify-center text-blue-600">
                <Info size={19} className="stroke-[2.2]" />
              </div>
              <h2 className="text-[16px] font-bold text-gray-900">Important Rules & Conditions</h2>
            </div>

            {/* Accordion List */}
            <div className="divide-y divide-gray-50">
              {/* 1. Ride Standards */}
              <AccordionItem
                id="rideStandards"
                icon={ShieldCheck}
                title="Ride Standards"
                isExpanded={expandedSections.rideStandards}
                onToggle={toggleSection}
              >
                <div className="flex items-start gap-2.5">
                  <CheckCircle2 size={15} className="text-emerald-500 mt-0.5 flex-shrink-0" />
                  <span className="text-[13px] text-gray-600 leading-normal">
                    Minimum ride duration: 20 minutes OR 5 km distance
                  </span>
                </div>
                <div className="flex items-start gap-2.5">
                  <CheckCircle2 size={15} className="text-emerald-500 mt-0.5 flex-shrink-0" />
                  <span className="text-[13px] text-gray-600 leading-normal">
                    Only completed & paid rides count towards rewards
                  </span>
                </div>
                <div className="flex items-start gap-2.5">
                  <CheckCircle2 size={15} className="text-emerald-500 mt-0.5 flex-shrink-0" />
                  <span className="text-[13px] text-gray-600 leading-normal">
                    Cancelled rides do not qualify for any rewards
                  </span>
                </div>
                <div className="flex items-start gap-2.5">
                  <CheckCircle2 size={15} className="text-emerald-500 mt-0.5 flex-shrink-0" />
                  <span className="text-[13px] text-gray-600 leading-normal">
                    GPS must be enabled for accurate distance tracking
                  </span>
                </div>
              </AccordionItem>

              {/* 2. Cashback Rules */}
              <AccordionItem
                id="cashbackRules"
                icon={Coins}
                title="Cashback Rules"
                isExpanded={expandedSections.cashbackRules}
                onToggle={toggleSection}
              >
                <div className="flex items-start gap-2.5">
                  <CheckCircle2 size={15} className="text-emerald-500 mt-0.5 flex-shrink-0" />
                  <span className="text-[13px] text-gray-600 leading-normal">
                    Cashback is credited to your wallet within 24 hours of ride completion
                  </span>
                </div>
                <div className="flex items-start gap-2.5">
                  <CheckCircle2 size={15} className="text-emerald-500 mt-0.5 flex-shrink-0" />
                  <span className="text-[13px] text-gray-600 leading-normal">
                    Maximum cashback per ride is capped at ₹50
                  </span>
                </div>
                <div className="flex items-start gap-2.5">
                  <CheckCircle2 size={15} className="text-emerald-500 mt-0.5 flex-shrink-0" />
                  <span className="text-[13px] text-gray-600 leading-normal">
                    Cashback offers cannot be combined with other promo codes
                  </span>
                </div>
                <div className="flex items-start gap-2.5">
                  <CheckCircle2 size={15} className="text-emerald-500 mt-0.5 flex-shrink-0" />
                  <span className="text-[13px] text-gray-600 leading-normal">
                    Cashback is valid for 30 days from the date of credit
                  </span>
                </div>
              </AccordionItem>

              {/* 3. Referral Rules */}
              <AccordionItem
                id="referralRules"
                icon={UserPlus}
                title="Referral Rules"
                isExpanded={expandedSections.referralRules}
                onToggle={toggleSection}
              >
                <div className="flex items-start gap-2.5">
                  <CheckCircle2 size={15} className="text-emerald-500 mt-0.5 flex-shrink-0" />
                  <span className="text-[13px] text-gray-600 leading-normal">
                    Your friends must register using your unique referral link or code
                  </span>
                </div>
                <div className="flex items-start gap-2.5">
                  <CheckCircle2 size={15} className="text-emerald-500 mt-0.5 flex-shrink-0" />
                  <span className="text-[13px] text-gray-600 leading-normal">
                    Rewards are unlocked only after your referred friend completes their first ride
                  </span>
                </div>
                <div className="flex items-start gap-2.5">
                  <CheckCircle2 size={15} className="text-emerald-500 mt-0.5 flex-shrink-0" />
                  <span className="text-[13px] text-gray-600 leading-normal">
                    Referral rewards are capped at a maximum of 50 successful referrals per month
                  </span>
                </div>
                <div className="flex items-start gap-2.5">
                  <CheckCircle2 size={15} className="text-emerald-500 mt-0.5 flex-shrink-0" />
                  <span className="text-[13px] text-gray-600 leading-normal">
                    Self-referral or creating duplicate accounts will lead to account suspension
                  </span>
                </div>

                {/* Include dynamic admin settings block if available */}
                {infoBlocks.length > 0 && (
                  <div className="mt-4 pt-3 border-t border-gray-100/70 space-y-2">
                    <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Admin Promo Notes</p>
                    {infoBlocks.map((block) => (
                      <div
                        key={block.key}
                        className="text-[12px] leading-relaxed text-gray-500 prose prose-sm max-w-none bg-gray-50 p-2.5 rounded-xl border border-gray-100"
                        dangerouslySetInnerHTML={{ __html: block.html }}
                      />
                    ))}
                  </div>
                )}
              </AccordionItem>

              {/* 4. Wallet & Withdrawal Rules */}
              <AccordionItem
                id="walletRules"
                icon={CircleDollarSign}
                title="Wallet & Withdrawal Rules"
                isExpanded={expandedSections.walletRules}
                onToggle={toggleSection}
              >
                <div className="flex items-start gap-2.5">
                  <CheckCircle2 size={15} className="text-emerald-500 mt-0.5 flex-shrink-0" />
                  <span className="text-[13px] text-gray-600 leading-normal">
                    Minimum balance required for bank transfer is ₹100
                  </span>
                </div>
                <div className="flex items-start gap-2.5">
                  <CheckCircle2 size={15} className="text-emerald-500 mt-0.5 flex-shrink-0" />
                  <span className="text-[13px] text-gray-600 leading-normal">
                    Withdrawals are processed every Tuesday and Friday
                  </span>
                </div>
                <div className="flex items-start gap-2.5">
                  <CheckCircle2 size={15} className="text-emerald-500 mt-0.5 flex-shrink-0" />
                  <span className="text-[13px] text-gray-600 leading-normal">
                    Direct UPI transfers require verified KYC documents
                  </span>
                </div>
                <div className="flex items-start gap-2.5">
                  <CheckCircle2 size={15} className="text-emerald-500 mt-0.5 flex-shrink-0" />
                  <span className="text-[13px] text-gray-600 leading-normal">
                    Bonus earnings from referrals cannot be directly withdrawn but can be used for rides
                  </span>
                </div>
              </AccordionItem>

              {/* 5. Fraud Penalties */}
              <AccordionItem
                id="fraudPenalties"
                icon={AlertTriangle}
                title="Fraud Penalties"
                isExpanded={expandedSections.fraudPenalties}
                onToggle={toggleSection}
              >
                <div className="flex items-start gap-2.5">
                  <CheckCircle2 size={15} className="text-emerald-500 mt-0.5 flex-shrink-0" />
                  <span className="text-[13px] text-gray-600 leading-normal">
                    Any suspicious activity or automated bots will result in immediate ban
                  </span>
                </div>
                <div className="flex items-start gap-2.5">
                  <CheckCircle2 size={15} className="text-emerald-500 mt-0.5 flex-shrink-0" />
                  <span className="text-[13px] text-gray-600 leading-normal">
                    Failed ride manipulation or collusion with drivers/riders cancels all pending bonuses
                  </span>
                </div>
                <div className="flex items-start gap-2.5">
                  <CheckCircle2 size={15} className="text-emerald-500 mt-0.5 flex-shrink-0" />
                  <span className="text-[13px] text-gray-600 leading-normal">
                    We reserve the right to audit and reverse any rewards credited in error
                  </span>
                </div>
              </AccordionItem>
            </div>
          </div>
        ) : (
          <div className="bg-white rounded-[28px] border border-gray-100 p-8 shadow-sm text-center">
            <div className="w-16 h-16 rounded-2xl bg-emerald-50 text-emerald-500 flex items-center justify-center mx-auto shadow-inner">
              <Gift size={28} />
            </div>
            <p className="text-sm font-semibold text-gray-800 mt-4">Successful Referrals</p>
            <p className="text-4xl font-extrabold text-[#4076ea] mt-2">{profile.referralCount}</p>
            <p className="text-xs text-gray-400 mt-4 max-w-[240px] mx-auto leading-relaxed">
              Your rewards are credited to the referral wallet first. Once approved, they move into your main wallet.
            </p>
          </div>
        )}
      </div>

      {/* Copy Code Notification Toast */}
      <AnimatePresence>
        {copied ? (
          <motion.div
            initial={{ opacity: 0, y: 20, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 20, scale: 0.95 }}
            className="fixed bottom-24 left-1/2 -translate-x-1/2 rounded-2xl bg-gray-900 text-white px-5 py-3 text-xs font-semibold shadow-2xl flex items-center gap-2 border border-gray-800 z-50"
          >
            <CheckCircle2 size={14} className="text-emerald-400" />
            <span>Referral code copied successfully!</span>
          </motion.div>
        ) : null}
      </AnimatePresence>

      <BottomNavbar />
    </div>
  );
};

export default Referral;
