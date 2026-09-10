import React from 'react';
import { OverlayView } from '@react-google-maps/api';

const DEFAULT_TITLE = 'Map marker';

const toPixelValue = (value, fallback = 0) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
};

const getAnchorTransform = (anchor = null) => {
  if (!anchor) {
    return '';
  }

  const x = toPixelValue(anchor.x);
  const y = toPixelValue(anchor.y);
  return `translate(${-x}px, ${-y}px)`;
};

const SymbolMarker = ({ icon, title }) => {
  const scale = toPixelValue(icon?.scale, 1);

  return (
    <div
      className="pointer-events-none"
      style={{ transform: getAnchorTransform(icon?.anchor) }}
      title={title}
      aria-label={title}
    >
      <svg
        viewBox="0 0 24 24"
        width={24 * scale}
        height={24 * scale}
        style={{ display: 'block', overflow: 'visible' }}
      >
        <path
          d={String(icon?.path || '')}
          fill={String(icon?.fillColor || '#111827')}
          fillOpacity={Number(icon?.fillOpacity ?? 1)}
          stroke={String(icon?.strokeColor || 'transparent')}
          strokeWidth={Number(icon?.strokeWeight ?? 0)}
          vectorEffect="non-scaling-stroke"
        />
      </svg>
    </div>
  );
};

const ImageMarker = ({ icon, title }) => {
  const scaledSize = icon?.scaledSize || null;

  return (
    <div
      className="pointer-events-none"
      style={{ transform: getAnchorTransform(icon?.anchor) }}
      title={title}
      aria-label={title}
    >
      <img
        src={icon.url}
        alt={title}
        draggable={false}
        style={{
          display: 'block',
          width: `${toPixelValue(scaledSize?.width, 40)}px`,
          height: `${toPixelValue(scaledSize?.height, 40)}px`,
          objectFit: 'contain',
        }}
      />
    </div>
  );
};

const DefaultMarker = ({ title }) => (
  <div
    className="pointer-events-none rounded-full border-[3px] border-white shadow-[0_10px_20px_rgba(15,23,42,0.18)]"
    style={{ width: 18, height: 18, background: '#111827' }}
    title={title}
    aria-label={title}
  />
);

const normalizePosition = (position) => {
  if (!position) {
    return null;
  }

  const lat = Number(position.lat);
  const lng = Number(position.lng);

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return null;
  }

  return { lat, lng };
};

const AdvancedMapMarker = ({ position, icon, title = DEFAULT_TITLE }) => {
  const normalizedPosition = normalizePosition(position);

  if (!normalizedPosition) {
    return null;
  }

  return (
    <OverlayView
      position={normalizedPosition}
      mapPaneName={OverlayView.OVERLAY_MOUSE_TARGET}
      getPixelPositionOffset={() => ({ x: 0, y: 0 })}
    >
      <>
        {icon?.url ? (
          <ImageMarker icon={icon} title={title} />
        ) : icon?.path ? (
          <SymbolMarker icon={icon} title={title} />
        ) : (
          <DefaultMarker title={title} />
        )}
      </>
    </OverlayView>
  );
};

export default AdvancedMapMarker;
