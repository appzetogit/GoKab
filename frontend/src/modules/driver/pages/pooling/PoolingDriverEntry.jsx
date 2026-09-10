import React, { useState } from 'react';
import { ArrowLeft, ChevronRight, MessageSquare, Users } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import {
  saveDriverRegistrationSession,
  sendPoolingDriverOnboardingOtp,
  verifyPoolingDriverOnboardingOtp,
} from '../../services/registrationService';

const unwrap = (response) => response?.data?.data || response?.data || response;

const getErrorMessage = (err) => String(
  err?.message || err?.response?.data?.message || '',
).trim() || 'Something went wrong';

const PoolingDriverEntry = () => {
  const navigate = useNavigate();
  const [step, setStep] = useState('phone');
  const [phone, setPhone] = useState('');
  const [registrationId, setRegistrationId] = useState('');
  const [otp, setOtp] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSendOtp = async () => {
    if (phone.length !== 10) {
      setError('Enter a valid 10-digit mobile number');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const response = await sendPoolingDriverOnboardingOtp({ phone });
      const payload = unwrap(response);
      setRegistrationId(payload?.session?.registrationId || '');
      setStep('otp');
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyOtp = async () => {
    if (otp.length !== 4) {
      setError('Enter the 4-digit code');
      return;
    }
    setLoading(true);
    setError('');
    try {
      await verifyPoolingDriverOnboardingOtp({ registrationId, phone, otp });
      saveDriverRegistrationSession({ registrationId, phone });
      navigate('/taxi/driver/pooling/onboarding');
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#F8FAFC] px-6 py-10">
      <div className="mx-auto max-w-sm">
        <button
          type="button"
          onClick={() => navigate('/taxi/driver/login')}
          className="mb-8 flex h-12 w-12 items-center justify-center rounded-2xl bg-white border border-slate-100 text-slate-900 shadow-xl shadow-slate-100"
        >
          <ArrowLeft size={20} strokeWidth={3} />
        </button>

        <div className="mb-8 flex items-center gap-3">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-indigo-50 text-indigo-600">
            <Users size={26} />
          </div>
          <div>
            <h1 className="text-2xl font-black tracking-tight text-slate-900">Pooling Partner</h1>
            <p className="text-sm font-semibold text-slate-500">Register your vehicle for shared routes</p>
          </div>
        </div>

        <div className="rounded-[32px] bg-white p-6 shadow-[0_20px_50px_rgba(0,0,0,0.06)] border border-slate-50 space-y-6">
          {step === 'phone' ? (
            <>
              <div>
                <label className="mb-2 block text-[10px] font-black uppercase tracking-widest text-slate-400">
                  Mobile Number
                </label>
                <div className="flex items-center gap-3 rounded-2xl border-2 border-slate-50 bg-slate-50 px-4 py-3.5 focus-within:border-indigo-400 focus-within:bg-white">
                  <span className="text-sm font-black text-slate-400">+91</span>
                  <input
                    type="tel"
                    inputMode="numeric"
                    maxLength={10}
                    value={phone}
                    onChange={(e) => {
                      setPhone(e.target.value.replace(/\D/g, ''));
                      if (error) setError('');
                    }}
                    placeholder="10-digit mobile number"
                    className="flex-1 bg-transparent text-lg font-bold text-slate-900 outline-none placeholder:text-slate-300"
                  />
                </div>
              </div>

              {error ? (
                <div className="rounded-xl bg-rose-50 p-3 text-center text-xs font-bold text-rose-600">{error}</div>
              ) : null}

              <button
                type="button"
                onClick={handleSendOtp}
                disabled={loading || phone.length !== 10}
                className={`flex h-14 w-full items-center justify-center gap-2 rounded-2xl text-sm font-black uppercase tracking-widest transition-all ${
                  phone.length === 10 ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-300'
                }`}
              >
                {loading ? (
                  <div className="h-5 w-5 animate-spin rounded-full border-4 border-white/20 border-t-white" />
                ) : (
                  <>
                    Send OTP
                    <ChevronRight size={18} strokeWidth={3} />
                  </>
                )}
              </button>
            </>
          ) : (
            <>
              <div>
                <p className="mb-4 text-sm font-semibold text-slate-500">
                  Code sent to <span className="font-black text-slate-900">+91 {phone}</span>
                </p>
                <label className="mb-2 block text-[10px] font-black uppercase tracking-widest text-slate-400">
                  Enter OTP
                </label>
                <input
                  type="tel"
                  inputMode="numeric"
                  maxLength={4}
                  value={otp}
                  onChange={(e) => {
                    setOtp(e.target.value.replace(/\D/g, ''));
                    if (error) setError('');
                  }}
                  placeholder="4-digit code"
                  className="w-full rounded-2xl border-2 border-slate-50 bg-slate-50 px-4 py-3.5 text-center text-2xl font-black tracking-[0.4em] text-slate-900 outline-none focus:border-indigo-400 focus:bg-white"
                />
              </div>

              {error ? (
                <div className="rounded-xl bg-rose-50 p-3 text-center text-xs font-bold text-rose-600">{error}</div>
              ) : null}

              <button
                type="button"
                onClick={handleVerifyOtp}
                disabled={loading || otp.length !== 4}
                className={`flex h-14 w-full items-center justify-center gap-2 rounded-2xl text-sm font-black uppercase tracking-widest transition-all ${
                  otp.length === 4 ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-300'
                }`}
              >
                {loading ? (
                  <div className="h-5 w-5 animate-spin rounded-full border-4 border-white/20 border-t-white" />
                ) : (
                  <>
                    Verify Code
                    <ChevronRight size={18} strokeWidth={3} />
                  </>
                )}
              </button>

              <button
                type="button"
                onClick={() => { setStep('phone'); setOtp(''); setError(''); }}
                className="flex w-full items-center justify-center gap-2 text-xs font-black uppercase tracking-widest text-slate-400"
              >
                <MessageSquare size={14} />
                Change Number
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default PoolingDriverEntry;
