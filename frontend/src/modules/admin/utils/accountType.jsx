import React from 'react';
import { Building2, Car, UserCheck, ShieldCheck } from 'lucide-react';

export const getAccountTypeMeta = (val) => {
  const typeStr = typeof val === 'object' && val !== null
    ? String(val.account_type || val.accountType || val.onboarding_role || val.onboarding?.role || val.role || '').toLowerCase()
    : String(val || '').toLowerCase();

  if (['super_fleet_owner', 'super-fleet-owner', 'superfleetowner', 'service_center', 'service-center'].includes(typeStr)) {
    return {
      key: 'super_fleet_owner',
      label: 'Super Fleet Owner',
      icon: Building2,
      badgeClass: 'bg-purple-50 text-purple-700 border-purple-200',
      iconClass: 'text-purple-600',
    };
  }

  if (['vendor', 'owner', 'fleet_owner', 'owners'].includes(typeStr)) {
    return {
      key: 'vendor',
      label: 'Vendor',
      icon: Car,
      badgeClass: 'bg-amber-50 text-amber-700 border-amber-200',
      iconClass: 'text-amber-600',
    };
  }

  if (['service_center_staff', 'service-center-staff', 'staff'].includes(typeStr)) {
    return {
      key: 'staff',
      label: 'Staff',
      icon: ShieldCheck,
      badgeClass: 'bg-teal-50 text-teal-700 border-teal-200',
      iconClass: 'text-teal-600',
    };
  }

  return {
    key: 'driver',
    label: 'Driver',
    icon: UserCheck,
    badgeClass: 'bg-indigo-50 text-indigo-700 border-indigo-200',
    iconClass: 'text-indigo-600',
  };
};

export const renderAccountTypeBadge = (driverOrType) => {
  const meta = getAccountTypeMeta(driverOrType);
  const IconComponent = meta.icon;

  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold border ${meta.badgeClass}`}>
      <IconComponent size={12} className={meta.iconClass} />
      {meta.label}
    </span>
  );
};
