import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ArrowLeft, User, Phone, Mail, ChevronRight, Check, Loader2 } from 'lucide-react';
import userBusService from '../../services/busService';
import { userAuthService } from '../../services/authService';

const getRoutePrefix = (pathname = '') => (pathname.startsWith('/taxi/user') ? '/taxi/user' : '');

const loadRazorpayScript = () =>
  new Promise((resolve) => {
    if (window.Razorpay) {
      resolve(true);
      return;
    }

    const script = document.createElement('script');
    script.src = 'https://checkout.razorpay.com/v1/checkout.js';
    script.async = true;
    script.onload = () => resolve(true);
    script.onerror = () => resolve(false);
    document.body.appendChild(script);
  });

const formatTravelDate = (dateStr) => {
  if (!dateStr) return '';
  try {
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-US', {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
    });
  } catch (err) {
    return dateStr;
  }
};

const BusDetails = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const routePrefix = useMemo(() => getRoutePrefix(location.pathname), [location.pathname]);
  const state = location.state || {};
  const { bus, fromCity, toCity, date, selectedSeats, totalFare } = state;
  const [name, setName] = useState('');
  const [age, setAge] = useState('');
  const [gender, setGender] = useState('Male');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [isPaying, setIsPaying] = useState(false);
  const [travellerMode, setTravellerMode] = useState('self');
  const [profileLoading, setProfileLoading] = useState(true);
  const [profileData, setProfileData] = useState(null);
  const [showTestPaymentModal, setShowTestPaymentModal] = useState(false);
  const [testOrderPayload, setTestOrderPayload] = useState(null);

  const unwrapPayload = (response) => response?.data?.data || response?.data || response || {};

  useEffect(() => {
    let active = true;

    const storedProfile = (() => {
      try {
        return JSON.parse(localStorage.getItem('userInfo') || '{}');
      } catch {
        return {};
      }
    })();

    const applyProfile = (profile = {}) => {
      if (!active) {
        return;
      }

      const nextProfile = {
        name: String(profile?.name || '').trim(),
        email: String(profile?.email || '').trim(),
        phone: String(profile?.phone || '').trim(),
      };

      setProfileData(nextProfile);

      if (travellerMode === 'self') {
        setName(nextProfile.name || '');
        setEmail(nextProfile.email || '');
        setPhone(nextProfile.phone || '');
      }
    };

    applyProfile(storedProfile);

    const loadProfile = async () => {
      try {
        const response = await userAuthService.getCurrentUser();
        const user = response?.data?.user || {};
        const normalizedUser = {
          name: user.name || storedProfile?.name || '',
          email: user.email || storedProfile?.email || '',
          phone: user.phone || storedProfile?.phone || '',
        };

        localStorage.setItem('userInfo', JSON.stringify({
          ...storedProfile,
          ...user,
        }));
        applyProfile(normalizedUser);
      } catch {
        applyProfile(storedProfile);
      } finally {
        if (active) {
          setProfileLoading(false);
        }
      }
    };

    loadProfile();

    return () => {
      active = false;
    };
  }, [travellerMode]);

  const applySelfProfile = () => {
    setTravellerMode('self');
    setName(profileData?.name || '');
    setEmail(profileData?.email || '');
    setPhone(profileData?.phone || '');
    setError('');
  };

  const switchToSomeoneElse = () => {
    setTravellerMode('other');
    setName('');
    setAge('');
    setGender('Male');
    setPhone('');
    setEmail('');
    setError('');
  };

  if (!bus || !selectedSeats?.length) {
    navigate(`${routePrefix}/bus`, { replace: true });
    return null;
  }

  const handleContinue = async () => {
    if (isPaying) return;

    if (!name || !age || !phone) {
      setError('Please fill in all passenger details.');
      return;
    }

    setError('');
    setIsPaying(true);

    try {
      const scriptLoaded = await loadRazorpayScript();
      if (!scriptLoaded) {
        throw new Error('Razorpay SDK failed to load');
      }

      const passenger = { name, age, gender, phone, email };
      const orderResponse = await userBusService.createBookingOrder({
        busServiceId: bus.busServiceId,
        scheduleId: bus.scheduleId,
        travelDate: date,
        seatIds: selectedSeats.map((seat) => seat.id),
        passenger,
      });
      const order = unwrapPayload(orderResponse);

      if (!order.keyId || !order.orderId) {
        throw new Error('Unable to start bus payment');
      }

      if (order.orderId.startsWith('order_test_') || order.keyId.includes('DemoKey')) {
        setTestOrderPayload(order);
        setShowTestPaymentModal(true);
        setIsPaying(false);
        return;
      }

      const rzp = new window.Razorpay({
        key: order.keyId,
        amount: order.amount,
        currency: order.currency || 'INR',
        name: bus.operator || 'Bus Booking',
        description: `${fromCity} to ${toCity}`,
        order_id: order.orderId,
        prefill: {
          name,
          email,
          contact: phone,
        },
        modal: {
          ondismiss: () => {
            setIsPaying(false);
          },
        },
        theme: {
          color: '#C2410C',
        },
        handler: async (response) => {
          try {
            const verifyResponse = await userBusService.verifyBookingPayment(response);
            const booking = unwrapPayload(verifyResponse);
            navigate(`${routePrefix}/bus/confirm`, {
              replace: true,
              state: {
                booking,
                fromCity,
                toCity,
                date,
              },
            });
          } catch (verifyError) {
            setError(verifyError?.message || 'Payment verification failed');
            setIsPaying(false);
          }
        },
      });

      rzp.on('payment.failed', (event) => {
        const message = event?.error?.description || event?.error?.reason || 'Payment failed';
        setError(message);
        setIsPaying(false);
      });

      rzp.open();
    } catch (err) {
      setError(err?.message || 'Unable to continue with payment');
      setIsPaying(false);
    }
  };

  const handleConfirmTestPayment = async () => {
    if (!testOrderPayload) return;

    setIsPaying(true);
    setError('');

    try {
      const testPaymentId = `pay_test_${Date.now()}`;
      const verifyResponse = await userBusService.verifyBookingPayment({
        razorpay_order_id: testOrderPayload.orderId,
        razorpay_payment_id: testPaymentId,
        razorpay_signature: 'test_signature',
      });
      const booking = unwrapPayload(verifyResponse);
      setShowTestPaymentModal(false);
      navigate(`${routePrefix}/bus/confirm`, {
        replace: true,
        state: {
          booking,
          fromCity,
          toCity,
          date,
        },
      });
    } catch (verifyError) {
      setError(verifyError?.message || 'Payment verification failed');
      setIsPaying(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 max-w-lg mx-auto font-sans pb-32">
      <div className="bg-white px-5 pt-10 pb-4 sticky top-0 z-20 border-b border-slate-100 shadow-sm">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate(-1)}
            className="w-9 h-9 rounded-xl border border-slate-200 bg-white flex items-center justify-center shadow-sm active:scale-95 transition-all"
          >
            <ArrowLeft size={18} className="text-slate-900" />
          </button>
          <div className="flex-1">
            <h1 className="text-lg font-bold text-slate-900 truncate">Passenger Details</h1>
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mt-0.5">
              {selectedSeats.length} Seat(s) • {fromCity} to {toCity}
            </p>
          </div>
        </div>
      </div>

      <div className="px-5 pt-6 space-y-6">
        <div className="bg-slate-900 rounded-3xl p-6 text-white shadow-xl shadow-slate-200">
          <div className="flex justify-between items-start">
            <div>
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2">{formatTravelDate(date)} • {bus.departure}</p>
              <h3 className="text-xl font-bold leading-tight">{bus.operator}</h3>
              <p className="text-sm font-medium text-slate-400 mt-1">{bus.type}</p>
            </div>
            <div className="text-right">
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Seats</p>
              <p className="text-base font-bold">{selectedSeats.map((seat) => seat.label || seat.id).join(', ')}</p>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-3xl p-6 shadow-sm border border-slate-100 space-y-6">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h3 className="text-lg font-bold text-slate-900">Primary Passenger</h3>
              <p className="mt-1 text-xs font-semibold text-slate-500">Choose who is travelling, then confirm the details below.</p>
            </div>
            {profileLoading ? (
              <div className="flex items-center gap-2 rounded-full bg-slate-50 px-3 py-2 text-[10px] font-black uppercase tracking-[0.16em] text-slate-400">
                <Loader2 size={12} className="animate-spin" /> Loading
              </div>
            ) : null}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <button
              type="button"
              onClick={applySelfProfile}
              className={`rounded-2xl border px-4 py-3 text-left transition-all ${
                travellerMode === 'self'
                  ? 'border-slate-900 bg-slate-900 text-white shadow-lg'
                  : 'border-slate-200 bg-slate-50 text-slate-700'
              }`}
            >
              <p className="text-[10px] font-black uppercase tracking-[0.18em]">Self</p>
              <p className={`mt-1 text-sm font-black ${travellerMode === 'self' ? 'text-white' : 'text-slate-900'}`}>
                Use my profile
              </p>
              <p className={`mt-1 text-[11px] font-semibold ${travellerMode === 'self' ? 'text-white/70' : 'text-slate-500'}`}>
                Name, phone, and email auto-fill from your account.
              </p>
            </button>
            <button
              type="button"
              onClick={switchToSomeoneElse}
              className={`rounded-2xl border px-4 py-3 text-left transition-all ${
                travellerMode === 'other'
                  ? 'border-slate-900 bg-slate-900 text-white shadow-lg'
                  : 'border-slate-200 bg-slate-50 text-slate-700'
              }`}
            >
              <p className="text-[10px] font-black uppercase tracking-[0.18em]">Other</p>
              <p className={`mt-1 text-sm font-black ${travellerMode === 'other' ? 'text-white' : 'text-slate-900'}`}>
                Book for someone else
              </p>
              <p className={`mt-1 text-[11px] font-semibold ${travellerMode === 'other' ? 'text-white/70' : 'text-slate-500'}`}>
                Enter passenger details manually.
              </p>
            </button>
          </div>

          {travellerMode === 'self' && profileData ? (
            <div className="rounded-2xl border border-emerald-100 bg-emerald-50 px-4 py-3 text-[12px] font-bold text-emerald-700">
              {profileData.email
                ? `Using ${profileData.email} for the ticket confirmation.`
                : 'Profile phone and name are filled. Add an email if you want the e-ticket mailed too.'}
            </div>
          ) : null}

          <div className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider ml-1">Full Name</label>
              <div className="flex min-w-0 items-center gap-3 bg-slate-50 border border-slate-100 rounded-2xl px-4 py-3">
                <User size={16} className="shrink-0 text-slate-400" />
                <input
                  type="text"
                  placeholder="Enter full name"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  className="min-w-0 flex-1 bg-transparent text-sm font-bold text-slate-900 focus:outline-none placeholder:text-slate-300"
                />
              </div>
            </div>

            <div className="flex gap-4">
              <div className="flex-1 space-y-1.5">
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider ml-1">Age</label>
                <input
                  type="number"
                  placeholder="Age"
                  value={age}
                  onChange={(event) => setAge(event.target.value)}
                  className="w-full bg-slate-50 border border-slate-100 rounded-2xl px-4 py-3 text-sm font-bold text-slate-900 focus:outline-none placeholder:text-slate-300"
                />
              </div>
              <div className="flex-[2] space-y-1.5">
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider ml-1">Gender</label>
                <div className="flex bg-slate-50 border border-slate-100 rounded-2xl p-1">
                  {['Male', 'Female', 'Other'].map((item) => (
                    <button
                      key={item}
                      type="button"
                      onClick={() => setGender(item)}
                      className={`flex-1 py-2 text-xs font-bold rounded-xl transition-all ${gender === item ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'}`}
                    >
                      {item}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-3xl p-6 shadow-sm border border-slate-100 space-y-6">
          <div className="flex justify-between items-center">
            <h3 className="text-lg font-bold text-slate-900">Contact Info</h3>
            <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wider bg-slate-50 px-2 py-1 rounded-full">For e-ticket</span>
          </div>

          <div className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider ml-1">Mobile Number</label>
              <div className="flex min-w-0 items-center gap-3 bg-slate-50 border border-slate-100 rounded-2xl px-4 py-3">
                <Phone size={16} className="shrink-0 text-slate-400" />
                <input
                  type="tel"
                  placeholder="Mobile number"
                  value={phone}
                  onChange={(event) => setPhone(event.target.value)}
                  className="min-w-0 flex-1 bg-transparent text-sm font-bold text-slate-900 focus:outline-none placeholder:text-slate-300"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider ml-1">Email ID</label>
              <div className="flex min-w-0 items-center gap-3 bg-slate-50 border border-slate-100 rounded-2xl px-4 py-3">
                <Mail size={16} className="shrink-0 text-slate-400" />
                <input
                  type="email"
                  placeholder="Email address"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  className="min-w-0 flex-1 bg-transparent text-sm font-bold text-slate-900 focus:outline-none placeholder:text-slate-300"
                />
              </div>
            </div>
          </div>

          {error && (
            <div className="rounded-2xl border border-rose-100 bg-rose-50 px-4 py-3 text-xs font-bold text-rose-600">
              {error}
            </div>
          )}
        </div>
      </div>

      <div className="fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-lg px-5 pb-8 pt-4 bg-white border-t border-slate-100 z-30">
        <div className="flex items-center justify-between mb-4 px-1">
          <div>
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Payable Amount</p>
            <p className="text-2xl font-bold text-slate-900">₹{Number(totalFare || 0)}</p>
          </div>
          <div className="flex items-center gap-1.5 bg-emerald-50 px-3 py-1 rounded-full">
            <Check size={12} className="text-emerald-600" strokeWidth={3} />
            <p className="text-[10px] font-bold text-emerald-700">Taxes included</p>
          </div>
        </div>

        <motion.button
          whileTap={{ scale: 0.98 }}
          onClick={handleContinue}
          disabled={isPaying}
          className="w-full bg-slate-900 text-white py-4 rounded-2xl text-base font-bold flex items-center justify-center gap-2 shadow-lg disabled:opacity-70 transition-all"
        >
          {isPaying ? <Loader2 size={20} className="animate-spin" /> : 'Pay Now'}
          {!isPaying && <ChevronRight size={18} />}
        </motion.button>
      </div>

      {showTestPaymentModal && testOrderPayload && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-5">
          <div className="w-full max-w-sm rounded-3xl bg-white p-6 shadow-2xl">
            <p className="text-[10px] font-bold uppercase tracking-wider text-orange-500 mb-1">Razorpay Test Mode</p>
            <h3 className="text-lg font-bold text-slate-900 mb-4">GoKab Bus Booking</h3>
            <div className="rounded-2xl bg-slate-50 p-4 mb-5">
              <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">Amount to Pay</p>
              <p className="text-2xl font-bold text-slate-900">₹{Number(testOrderPayload.amount || 0) / 100}</p>
            </div>
            {error && (
              <div className="rounded-2xl border border-rose-100 bg-rose-50 px-4 py-3 mb-3 text-xs font-bold text-rose-600">
                {error}
              </div>
            )}
            <motion.button
              whileTap={{ scale: 0.98 }}
              onClick={handleConfirmTestPayment}
              disabled={isPaying}
              className="w-full bg-slate-900 text-white py-3.5 rounded-2xl text-sm font-bold flex items-center justify-center gap-2 disabled:opacity-70 mb-2"
            >
              {isPaying ? <Loader2 size={18} className="animate-spin" /> : `Pay ₹${Number(testOrderPayload.amount || 0) / 100} (Simulate Success)`}
            </motion.button>
            <button
              onClick={() => {
                setShowTestPaymentModal(false);
                setIsPaying(false);
              }}
              className="w-full py-3 text-sm font-bold text-slate-400"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default BusDetails;
