import React, { useState, useEffect } from 'react';
import { Shield, Check, Zap, Sparkles, Clock, AlertCircle, ArrowRight, Loader2, Bell, BellOff, Car, PhoneCall, RefreshCw } from 'lucide-react';
import api from '../../../shared/api/axiosInstance';

export default function DriverSubscriptionPlans() {
  const [tiers, setTiers] = useState([]);
  const [currentSubscription, setCurrentSubscription] = useState(null);
  const [billingCycle, setBillingCycle] = useState('monthly'); // 'monthly' | 'yearly'
  const [isLoading, setIsLoading] = useState(true);
  const [purchasingTierId, setPurchasingTierId] = useState(null);
  const [errorMsg, setErrorMsg] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  const loadSubscriptionData = async () => {
    try {
      setIsLoading(true);
      setErrorMsg('');
      const [tiersRes, currentRes] = await Promise.all([
        api.get('/subscription/tiers'),
        api.get('/subscription/current'),
      ]);

      const tierList = tiersRes?.data?.data?.results || tiersRes?.data?.results || [];
      setTiers(Array.isArray(tierList) ? tierList : []);

      const effectiveData = currentRes?.data?.data || currentRes?.data || null;
      setCurrentSubscription(effectiveData);
    } catch (err) {
      console.error('Error loading subscription data:', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadSubscriptionData();
  }, []);

  const handleCheckout = async (tier) => {
    try {
      setPurchasingTierId(tier._id);
      setErrorMsg('');
      setSuccessMsg('');

      // Call checkout API
      const checkoutRes = await api.post('/subscription/checkout', {
        tierId: tier._id,
        billingCycle,
      });

      const checkoutData = checkoutRes?.data?.data || checkoutRes?.data;
      if (!checkoutData || !checkoutData.orderId) {
        throw new Error('Failed to create Razorpay checkout order');
      }

      // Check if Razorpay script is loaded in window
      if (!window.Razorpay) {
        // Load Razorpay SDK script dynamically
        await new Promise((resolve, reject) => {
          const script = document.createElement('script');
          script.src = 'https://checkout.razorpay.com/v1/checkout.js';
          script.onload = resolve;
          script.onerror = () => reject(new Error('Failed to load Razorpay SDK'));
          document.body.appendChild(script);
        });
      }

      const options = {
        key: checkoutData.keyId,
        amount: checkoutData.amount * 100,
        currency: checkoutData.currency || 'INR',
        name: 'GoKab Driver Tier Pass',
        description: `${tier.name} (${billingCycle.toUpperCase()}) Pass`,
        order_id: checkoutData.orderId,
        handler: async (response) => {
          try {
            setIsLoading(true);
            const verifyRes = await api.post('/subscription/verify-payment', {
              razorpay_order_id: response.razorpay_order_id,
              razorpay_payment_id: response.razorpay_payment_id,
              razorpay_signature: response.razorpay_signature,
            });

            const result = verifyRes?.data?.data || verifyRes?.data;
            if (result?.action === 'activated_immediately') {
              setSuccessMsg(`Congratulations! Your ${tier.name} plan is now active!`);
            } else if (result?.action === 'queued_for_next_cycle') {
              setSuccessMsg(`Your ${tier.name} plan has been queued for your next billing cycle!`);
            } else {
              setSuccessMsg('Payment verified and subscription updated successfully!');
            }

            loadSubscriptionData();
          } catch (vErr) {
            setErrorMsg(vErr?.response?.data?.message || 'Payment verification failed');
          } finally {
            setIsLoading(false);
            setPurchasingTierId(null);
          }
        },
        prefill: {
          name: 'Driver',
        },
        theme: {
          color: tier.badge_color_hex || '#10B981',
        },
      };

      const rzpInstance = new window.Razorpay(options);
      rzpInstance.open();
    } catch (err) {
      console.error('Checkout error:', err);
      setErrorMsg(err?.response?.data?.message || err?.message || 'Checkout failed');
    } finally {
      setPurchasingTierId(null);
    }
  };

  const handleToggleReminders = async () => {
    try {
      await api.post('/subscription/toggle-reminders');
      loadSubscriptionData();
    } catch (err) {
      alert('Failed to toggle renewal notifications');
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-6">
        <div className="text-center space-y-3">
          <Loader2 className="w-10 h-10 text-emerald-600 animate-spin mx-auto" />
          <p className="text-sm font-bold text-gray-600">Loading Subscription Tiers...</p>
        </div>
      </div>
    );
  }

  const activeSubInfo = currentSubscription?.subscription || null;
  const isDefaultFallback = Boolean(!activeSubInfo && currentSubscription);

  return (
    <div className="min-h-screen bg-gray-50 p-4 md:p-8 max-w-6xl mx-auto space-y-8 pb-20">
      {/* HEADER */}
      <div className="text-center space-y-3 max-w-2xl mx-auto pt-4">
        <div className="inline-flex items-center gap-2 px-4 py-1.5 bg-emerald-100/80 text-emerald-800 rounded-full text-xs font-black uppercase tracking-wider">
          <Sparkles size={14} /> Driver Priority Pass
        </div>
        <h1 className="text-3xl md:text-4xl font-black text-gray-900 tracking-tight">Choose Your Subscription Tier</h1>
        <p className="text-sm font-medium text-gray-600">
          Lower your ride commission down to 0%, get VIP priority dispatch, and unlock outstation & airport rides!
        </p>

        {/* MONTHLY / YEARLY TOGGLE */}
        <div className="pt-4 inline-flex items-center p-1.5 bg-gray-200/80 rounded-2xl">
          <button
            onClick={() => setBillingCycle('monthly')}
            className={`px-6 py-2.5 rounded-xl font-bold text-xs transition ${billingCycle === 'monthly' ? 'bg-white text-gray-900 shadow-md' : 'text-gray-600 hover:text-gray-900'}`}
          >
            Monthly Pass
          </button>
          <button
            onClick={() => setBillingCycle('yearly')}
            className={`px-6 py-2.5 rounded-xl font-bold text-xs transition flex items-center gap-1.5 ${billingCycle === 'yearly' ? 'bg-emerald-600 text-white shadow-md' : 'text-gray-600 hover:text-gray-900'}`}
          >
            Yearly Pass <span className="bg-emerald-800/40 text-emerald-100 text-[10px] px-2 py-0.5 rounded-full font-black">Save ~17%</span>
          </button>
        </div>
      </div>

      {/* MESSAGES */}
      {errorMsg && (
        <div className="p-4 bg-rose-50 border border-rose-200 text-rose-800 text-sm font-bold rounded-2xl max-w-2xl mx-auto">
          {errorMsg}
        </div>
      )}
      {successMsg && (
        <div className="p-4 bg-emerald-50 border border-emerald-200 text-emerald-800 text-sm font-bold rounded-2xl max-w-2xl mx-auto">
          {successMsg}
        </div>
      )}

      {/* CURRENT ACTIVE PLAN BANNER */}
      {currentSubscription && (
        <div className="bg-gradient-to-br from-slate-900 to-slate-800 text-white p-6 rounded-3xl shadow-xl border border-slate-700 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span
                className="w-3.5 h-3.5 rounded-full"
                style={{ backgroundColor: currentSubscription.badge_color_hex || '#10B981' }}
              />
              <h2 className="text-xl font-black">{currentSubscription.name}</h2>
              {isDefaultFallback && (
                <span className="px-2.5 py-0.5 bg-gray-700 text-gray-300 text-[10px] font-bold uppercase rounded-full">
                  Free Default Fallback
                </span>
              )}
              {activeSubInfo && (
                <span className="px-2.5 py-0.5 bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 text-[10px] font-bold uppercase rounded-full">
                  Active
                </span>
              )}
            </div>
            <p className="text-xs text-slate-300">
              Commission: <strong className="text-emerald-400 font-black">{currentSubscription.commission_percent}%</strong> | Priority Score: <strong>{currentSubscription.priority_score}</strong> | Search Radius: <strong>{currentSubscription.search_radius_multiplier}x</strong>
            </p>
            {activeSubInfo && (
              <p className="text-[11px] text-slate-400 pt-1">
                Pass Expires: <strong>{new Date(activeSubInfo.end_date).toLocaleDateString()}</strong>
                {activeSubInfo.queued_tier && (
                  <span className="ml-2 text-amber-400 font-bold">
                    (Queued next: {activeSubInfo.queued_tier.name})
                  </span>
                )}
              </p>
            )}
          </div>

          {activeSubInfo && (
            <button
              onClick={handleToggleReminders}
              className="flex items-center gap-2 px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold rounded-xl border border-slate-600 transition"
            >
              {activeSubInfo.suppress_renewal_reminders ? (
                <> <BellOff size={14} /> Enable Renewal Reminders </>
              ) : (
                <> <Bell size={14} /> Suppress Renewal Reminders </>
              )}
            </button>
          )}
        </div>
      )}

      {/* DYNAMIC SUBSCRIPTION CARDS GRID */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {tiers.map((tier) => {
          const price = billingCycle === 'yearly' ? tier.price_yearly : tier.price_monthly;
          const isCurrentActive = activeSubInfo && String(activeSubInfo.tier_id?._id || activeSubInfo.tier_id) === String(tier._id);
          const isPurchasing = purchasingTierId === tier._id;

          return (
            <div
              key={tier._id}
              className={`bg-white rounded-3xl p-6 border transition-all relative flex flex-col justify-between shadow-sm hover:shadow-xl ${isCurrentActive ? 'border-2 border-emerald-500 ring-4 ring-emerald-50' : 'border-gray-100'}`}
            >
              {isCurrentActive && (
                <div className="absolute -top-3 right-6 bg-emerald-600 text-white text-[10px] font-black uppercase tracking-wider px-3 py-1 rounded-full shadow-sm">
                  Current Active Plan
                </div>
              )}

              <div className="space-y-4">
                {/* TIER BADGE & NAME */}
                <div className="flex items-center gap-3">
                  <div
                    className="w-10 h-10 rounded-2xl flex items-center justify-center text-white shadow-md font-black text-lg"
                    style={{ backgroundColor: tier.badge_color_hex || '#10B981' }}
                  >
                    <Shield size={20} />
                  </div>
                  <div>
                    <h3 className="text-xl font-black text-gray-900">{tier.name}</h3>
                    <p className="text-xs text-gray-500 font-medium">Priority Score: {tier.priority_score}</p>
                  </div>
                </div>

                {/* PRICE */}
                <div className="py-2 border-y border-gray-100">
                  <div className="flex items-baseline gap-1">
                    <span className="text-3xl font-black text-gray-900">₹{price}</span>
                    <span className="text-xs font-bold text-gray-400">/ {billingCycle}</span>
                  </div>
                </div>

                {/* KEY HIGHLIGHTS */}
                <div className="space-y-2 text-xs font-medium text-gray-700">
                  <div className="flex items-center gap-2 p-2 bg-emerald-50/60 rounded-xl text-emerald-900 font-bold">
                    <Check size={16} className="text-emerald-600 flex-shrink-0" />
                    <span>Commission Rate: <strong className="text-emerald-700 font-black">{tier.commission_percent}%</strong></span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Check size={16} className="text-emerald-600 flex-shrink-0" />
                    <span>Search Radius Multiplier: <strong>{tier.search_radius_multiplier}x</strong></span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Check size={16} className="text-emerald-600 flex-shrink-0" />
                    <span>Max Allowed Cash Debt: <strong>₹{tier.max_cash_debt_allowed}</strong></span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Check size={16} className="text-emerald-600 flex-shrink-0" />
                    <span>Support: <strong>{tier.support_channel_type_id?.name || 'Standard Chat'}</strong></span>
                  </div>
                  {tier.free_cancellations_per_day > 0 && (
                    <div className="flex items-center gap-2 text-emerald-800 font-semibold">
                      <Check size={16} className="text-emerald-600 flex-shrink-0" />
                      <span>{tier.free_cancellations_per_day} Free Cancellations / day</span>
                    </div>
                  )}
                </div>

                {/* GRANTED RIDE MODULES */}
                <div className="pt-2">
                  <span className="text-[11px] font-bold text-gray-400 uppercase tracking-wider block mb-2">Included Modules:</span>
                  <div className="flex flex-wrap gap-1.5">
                    {(tier.ride_module_ids || []).map((mod, idx) => (
                      <span key={idx} className="px-2.5 py-1 bg-gray-100 text-gray-800 rounded-lg text-xs font-bold">
                        {mod.display_name || mod.code}
                      </span>
                    ))}
                  </div>
                </div>
              </div>

              {/* ACTION BUTTON */}
              <div className="pt-6">
                <button
                  onClick={() => handleCheckout(tier)}
                  disabled={isPurchasing}
                  className={`w-full py-3 px-4 rounded-2xl font-bold text-sm shadow-md transition flex items-center justify-center gap-2 ${isCurrentActive ? 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100 border border-emerald-300' : 'bg-emerald-600 hover:bg-emerald-700 text-white shadow-emerald-200'}`}
                >
                  {isPurchasing ? (
                    <Loader2 size={18} className="animate-spin" />
                  ) : isCurrentActive ? (
                    'Extend / Renew Plan'
                  ) : (
                    <> Subscribe to {tier.name} <ArrowRight size={16} /> </>
                  )}
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
