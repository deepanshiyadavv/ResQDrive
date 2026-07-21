import React, { useEffect, useState, useRef, useMemo } from 'react';
import { MapContainer, TileLayer, Marker, Popup, Polyline, useMap } from 'react-leaflet';
import L from 'leaflet';
import { io } from 'socket.io-client';
import { Shield, Activity, MapPin, Ambulance, Navigation2, CheckCircle2, Sun, Moon } from 'lucide-react';
import { useTheme } from '../context/ThemeContext';
import 'leaflet/dist/leaflet.css';

// Fix Leaflet's default icon issue
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
});

// ─── Custom Icons ───────────────────────────────────────────────

// Hospital base station icon
const hospitalIcon = L.icon({
  iconUrl: '/hospital.png',
  iconSize: [34, 34],
  iconAnchor: [17, 17],
  className: 'hospital-marker'
});

// Crash / accident site icon — red alert triangle with pulse wrapper
const crashIcon = L.divIcon({
  className: 'custom-icon',
  html: `<div class="crash-pulse-wrapper" style="position: relative; width: 32px; height: 32px; display: flex; align-items: center; justify-content: center;">
           <div class="crash-pulse"></div>
           <img src="/crash.png" alt="Crash" style="width: 100%; height: 100%; object-fit: contain; position: relative; z-index: 2;" />
         </div>`,
  iconSize: [32, 32],
  iconAnchor: [16, 16],
});

// Ambulance dispatch icon — factory function for dynamic rotation
function createAmbulanceIcon(rotation = 0) {
  return L.divIcon({
    className: 'custom-icon',
    html: `<div style="width: 30px; height: 30px; display: flex; align-items: center; justify-content: center; transform: rotate(${rotation}deg); transition: transform 0.3s ease;">
             <img src="/ambulance.png" alt="Ambulance" style="width: 100%; height: 100%; object-fit: contain;" />
           </div>`,
    iconSize: [30, 30],
    iconAnchor: [15, 15],
  });
}

// ─── Bearing Calculation ────────────────────────────────────────

function computeBearing(from, to) {
  const toRad = (d) => (d * Math.PI) / 180;
  const toDeg = (r) => (r * 180) / Math.PI;
  const dLng = toRad(to[1] - from[1]);
  const lat1 = toRad(from[0]);
  const lat2 = toRad(to[0]);
  const y = Math.sin(dLng) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

// ─── Helper Components ──────────────────────────────────────────

function MapUpdater({ center }) {
  const map = useMap();
  useEffect(() => {
    if (center && center[0] !== 0) {
      map.flyTo(center, 14, { animate: true });
    }
  }, [center, map]);
  return null;
}

// Smooth Marker Component
const SmoothMarker = ({ position, icon, popupText }) => {
  const markerRef = useRef(null);

  useEffect(() => {
    if (markerRef.current) {
      markerRef.current.setLatLng(position);
    }
  }, [position]);

  return (
    <Marker position={position} icon={icon} ref={markerRef}>
      {popupText && <Popup className="font-mono">{popupText}</Popup>}
    </Marker>
  );
};

// ─── Main Component ─────────────────────────────────────────────

const HospitalMapDashboard = () => {
  const [currentLocation, setCurrentLocation] = useState(null);
  const [ambulanceLocation, setAmbulanceLocation] = useState(null);
  const [locationError, setLocationError] = useState('');
  const [isConnected, setIsConnected] = useState(false);
  const [deviceId, setDeviceId] = useState('AWAITING_DATA');
  const { theme, toggleTheme } = useTheme();
  const isDarkMode = theme === 'dark';

  // SOS & Animation state
  const [crashLocation, setCrashLocation] = useState(null);
  const [routeCoords, setRouteCoords] = useState([]);
  const [ambulancePos, setAmbulancePos] = useState(null);
  const [ambulanceRotation, setAmbulanceRotation] = useState(0);
  const animationRef = useRef(null);

  // Memoize the rotatable ambulance icon so it only rebuilds when rotation changes
  const activeAmbulanceIcon = useMemo(() => createAmbulanceIcon(ambulanceRotation), [ambulanceRotation]);

  // 1. Auto-Geolocation on Component Mount
  useEffect(() => {
    if ('geolocation' in navigator) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          setCurrentLocation([position.coords.latitude, position.coords.longitude]);
        },
        (error) => {
          console.error('Error getting location:', error);
          setLocationError(error.message || 'Failed to acquire GPS signal.');
        },
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
      );
    } else {
      alert('Geolocation is not supported by your browser.');
    }
  }, []);

  // 2. Live Socket Connection — Ambulance Tracking + Emergency SOS
  useEffect(() => {
    const socket = io('https://resqdrive-1grt.onrender.com', {
      reconnectionAttempts: 10,
      timeout: 10000,
    });

    socket.on('connect', () => {
      console.log('Connected to ResQDrive Dispatch Server');
      setIsConnected(true);
    });

    socket.on('disconnect', () => {
      console.log('Disconnected from server');
      setIsConnected(false);
      // Cleanup on socket disconnect to prevent memory leaks during rapid simulation runs
      if (animationRef.current) {
        clearInterval(animationRef.current);
        animationRef.current = null;
      }
      setCrashLocation(null);
      setRouteCoords([]);
      setAmbulancePos(null);
      setAmbulanceRotation(0);
    });

    // Legacy: direct location pings from hardware simulator
    socket.on('locationUpdate', (data) => {
      if (data && data.lat && data.lng) {
        setAmbulanceLocation([data.lat, data.lng]);
        setDeviceId(data.deviceId || 'AMB-UNKNOWN');
      }
    });

    // SOS: crash event with OSRM route for animated dispatch
    socket.on('emergency-sos', (alertData) => {
      // Set crash site marker
      if (alertData.coords) {
        setCrashLocation(alertData.coords);
      }

      setDeviceId(alertData.id || 'AMB-DISPATCH');

      // Animate ambulance along the OSRM route
      if (alertData.route && alertData.route.length > 0) {
        const route = alertData.route;
        setRouteCoords(route);

        // Clear any running animation
        if (animationRef.current) clearInterval(animationRef.current);

        let step = 0;
        const totalSteps = route.length;
        const totalDurationMs = 8000; // 8 seconds for full route traversal
        const intervalMs = Math.max(40, Math.floor(totalDurationMs / totalSteps));

        // Set initial position
        setAmbulancePos(route[0]);
        setAmbulanceLocation(route[0]);

        animationRef.current = setInterval(() => {
          if (step < totalSteps) {
            const currentCoord = route[step];
            setAmbulancePos(currentCoord);
            setAmbulanceLocation(currentCoord);

            // Compute bearing to next step for rotation
            if (step < totalSteps - 1) {
              const nextCoord = route[step + 1];
              const bearing = computeBearing(currentCoord, nextCoord);
              setAmbulanceRotation(bearing);
            }

            step++;
          } else {
            clearInterval(animationRef.current);
            animationRef.current = null;
          }
        }, intervalMs);
      }
    });

    socket.on('clear-hospital-alerts', () => {
      if (typeof setSosAlerts === 'function') setSosAlerts([]);
      setRouteCoords([]);
      
      if (animationRef.current) {
        clearInterval(animationRef.current);
        animationRef.current = null;
      }
      setCrashLocation(null);
      setAmbulancePos(null);
      setAmbulanceLocation(null);
      setDeviceId('AWAITING_DATA');
      setAmbulanceRotation(0);
    });

    return () => {
      socket.disconnect();
      // Cleanup animation interval to prevent memory leaks
      if (animationRef.current) {
        clearInterval(animationRef.current);
        animationRef.current = null;
      }
      // Reset SOS state on unmount
      setCrashLocation(null);
      setRouteCoords([]);
      setAmbulancePos(null);
      setAmbulanceRotation(0);
    };
  }, []);

  // Determine the display position for the ambulance (animated SOS takes priority)
  const displayAmbulancePos = ambulancePos || ambulanceLocation;

  // Calculate distance if both locations exist
  const getDistance = () => {
    if (!currentLocation || !displayAmbulancePos) return '0.00';
    const point1 = L.latLng(currentLocation);
    const point2 = L.latLng(displayAmbulancePos);
    return (point1.distanceTo(point2) / 1000).toFixed(2);
  };

  if (!currentLocation) {
    return (
      <div className="min-h-screen flex items-center justify-center text-cyan-400">
        Acquiring Secure GPS Signal...
      </div>
    );
  }

  // Theme-based classes
  const themeClasses = {
    mainBg: isDarkMode ? 'bg-[#050B14]' : 'bg-slate-50',
    textMain: isDarkMode ? 'text-white' : 'text-slate-900',
    textMuted: isDarkMode ? 'text-gray-500' : 'text-slate-500',
    sidebarBg: isDarkMode ? 'bg-[#0a1526]' : 'bg-white',
    borderColor: isDarkMode ? 'border-[#00e5ff]/20' : 'border-slate-200',
    accentColor: isDarkMode ? 'text-[#00e5ff]' : 'text-blue-600',
    cardBg: isDarkMode ? 'bg-[#050B14]' : 'bg-slate-50',
    cardBorder: isDarkMode ? 'border-gray-800' : 'border-slate-200',
    activeCardBg: isDarkMode ? 'bg-red-950/20' : 'bg-red-50',
    activeCardBorder: isDarkMode ? 'border-red-500/30' : 'border-red-200',
    overlayBg: isDarkMode ? 'bg-[#0a1526]/80' : 'bg-white/90',
  };

  return (
    <div className={`min-h-screen ${themeClasses.mainBg} ${themeClasses.textMain} font-mono flex flex-col md:flex-row overflow-hidden transition-colors duration-300`}>
      
      {/* LEFT: MAP CONTAINER (75%) */}
      <div className="w-full md:w-3/4 h-[50vh] md:h-screen relative z-0">
        
        {/* Connection Overlay */}
        <div className={`absolute top-6 left-6 z-[1000] ${themeClasses.overlayBg} backdrop-blur-md border ${isDarkMode ? 'border-[#00e5ff]/30 text-white' : 'border-slate-200 text-slate-800'} p-3 rounded-lg flex items-center gap-3 shadow-lg`}>
          <div className={`w-3 h-3 rounded-full ${isConnected ? 'bg-green-500 animate-pulse shadow-[0_0_10px_#22c55e]' : 'bg-red-500'}`}></div>
          <span className="font-bold tracking-widest text-sm uppercase">
            {isConnected ? 'Telemetry Online' : 'Telemetry Offline'}
          </span>
        </div>

        {locationError && (
          <div className="absolute top-20 left-6 z-[1000] bg-red-900/80 backdrop-blur-md border border-red-500/50 text-red-200 p-2 rounded text-xs max-w-xs shadow-lg">
            ⚠ {locationError}
          </div>
        )}

        <MapContainer 
          center={currentLocation} 
          zoom={14} 
          style={{ height: '100%', width: '100%' }}
          zoomControl={false}
        >
          {/* Dynamic Theme Tiles */}
          <TileLayer
            key={isDarkMode ? 'dark' : 'light'}
            url={isDarkMode 
              ? "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
              : "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png"
            }
            attribution='&copy; <a href="https://carto.com/attributions">CARTO</a>'
          />
          
          <MapUpdater center={currentLocation} />

          {/* Static Hospital Base Marker */}
          <Marker position={currentLocation} icon={hospitalIcon}>
            <Popup className="font-mono">
              <strong>Hospital Command Base</strong>
            </Popup>
          </Marker>

          {/* Crash Site Marker — pulsing red alert */}
          {crashLocation && (
            <Marker position={crashLocation} icon={crashIcon}>
              <Popup className="font-mono">
                <strong>⚠ Crash Site — SOS Active</strong>
              </Popup>
            </Marker>
          )}

          {/* Animated Ambulance Marker with rotation */}
          {displayAmbulancePos && (
            <SmoothMarker 
              position={displayAmbulancePos} 
              icon={activeAmbulanceIcon} 
              popupText={`Ambulance: ${deviceId}`} 
            />
          )}

          {/* OSRM Route Polyline (full road path) */}
          {routeCoords.length > 0 && (
            <Polyline 
              positions={routeCoords} 
              color="#ff1a1a" 
              weight={4} 
              opacity={0.8}
              dashArray="10, 8" 
              className="animate-dash"
            />
          )}

          {/* Fallback straight-line when no OSRM route but ambulance is live */}
          {routeCoords.length === 0 && displayAmbulancePos && (
            <Polyline 
              positions={[currentLocation, displayAmbulancePos]} 
              color="#ff1a1a" 
              weight={3} 
              dashArray="10, 10" 
              className="animate-dash"
            />
          )}
        </MapContainer>
      </div>

      {/* RIGHT: SIDEBAR (25%) */}
      <div className={`w-full md:w-1/4 h-[50vh] md:h-screen ${themeClasses.sidebarBg} border-l ${themeClasses.borderColor} p-6 flex flex-col overflow-y-auto transition-colors duration-300 shadow-[-10px_0_30px_rgba(0,0,0,0.1)] z-10`}>
        
        {/* Header with Theme Toggle */}
        <div className={`flex items-center justify-between mb-8 border-b ${themeClasses.borderColor} pb-4`}>
          <div className="flex items-center gap-3">
            <Shield className={`w-8 h-8 ${themeClasses.accentColor}`} />
            <h1 className={`text-xl font-bold tracking-widest ${themeClasses.accentColor} uppercase`}>Dispatch Ops</h1>
          </div>
          <button 
            onClick={toggleTheme}
            className={`p-2 rounded-full border ${themeClasses.borderColor} hover:bg-gray-500/10 transition-colors`}
          >
            {isDarkMode ? <Sun className="w-5 h-5 text-amber-400" /> : <Moon className="w-5 h-5 text-slate-600" />}
          </button>
        </div>

        <div className="space-y-8 flex-1">
          {/* Section: Hospital Status */}
          <div className={`${themeClasses.cardBg} border ${themeClasses.cardBorder} p-4 rounded-xl transition-colors duration-300`}>
            <h2 className={`text-xs ${themeClasses.textMuted} tracking-widest mb-3 flex items-center gap-2`}>
              <MapPin className={`w-4 h-4 ${themeClasses.accentColor}`} /> BASE COMMAND
            </h2>
            <div className="space-y-2">
              <div className="flex justify-between items-center text-sm">
                <span className={themeClasses.textMuted}>LAT</span>
                <span className={`font-bold ${themeClasses.textMain}`}>{currentLocation[0].toFixed(6)}</span>
              </div>
              <div className="flex justify-between items-center text-sm">
                <span className={themeClasses.textMuted}>LNG</span>
                <span className={`font-bold ${themeClasses.textMain}`}>{currentLocation[1].toFixed(6)}</span>
              </div>
            </div>
          </div>

          {/* Section: Active Fleet */}
          <div className={`border p-4 rounded-xl transition-colors duration-500 ${displayAmbulancePos ? `${themeClasses.activeCardBg} ${themeClasses.activeCardBorder}` : `${themeClasses.cardBg} ${themeClasses.cardBorder}`}`}>
            <h2 className={`text-xs ${themeClasses.textMuted} tracking-widest mb-3 flex items-center gap-2`}>
              <Ambulance className={`w-4 h-4 ${displayAmbulancePos ? 'text-red-500' : (isDarkMode ? 'text-gray-600' : 'text-slate-400')}`} /> 
              ACTIVE UNIT
            </h2>
            
            {displayAmbulancePos ? (
              <div className="space-y-4">
                <div className="flex items-center gap-2 bg-red-500/10 text-red-500 px-3 py-1.5 rounded text-xs font-bold tracking-wider border border-red-500/20 w-fit mb-4">
                  <span className="w-2 h-2 bg-red-500 rounded-full animate-ping"></span>
                  EN ROUTE
                </div>

                <div className="space-y-2">
                  <div className={`flex justify-between items-center text-sm border-b ${isDarkMode ? 'border-gray-800' : 'border-slate-200'} pb-2`}>
                    <span className={themeClasses.textMuted}>UNIT ID</span>
                    <span className="font-bold text-red-500">{deviceId}</span>
                  </div>
                  <div className={`flex justify-between items-center text-sm border-b ${isDarkMode ? 'border-gray-800' : 'border-slate-200'} pb-2`}>
                    <span className={themeClasses.textMuted}>DISTANCE</span>
                    <span className={`font-bold ${themeClasses.textMain}`}>{getDistance()} KM</span>
                  </div>
                  {crashLocation && (
                    <div className={`flex justify-between items-center text-sm border-b ${isDarkMode ? 'border-gray-800' : 'border-slate-200'} pb-2`}>
                      <span className={themeClasses.textMuted}>HEADING</span>
                      <span className={`font-bold ${themeClasses.textMain}`}>{ambulanceRotation.toFixed(0)}°</span>
                    </div>
                  )}
                  <div className="pt-2 space-y-1">
                    <div className={`flex justify-between items-center text-[10px] ${themeClasses.textMuted}`}>
                      <span>LIVE LAT</span>
                      <span>{displayAmbulancePos[0].toFixed(6)}</span>
                    </div>
                    <div className={`flex justify-between items-center text-[10px] ${themeClasses.textMuted}`}>
                      <span>LIVE LNG</span>
                      <span>{displayAmbulancePos[1].toFixed(6)}</span>
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <div className="text-center py-6">
                <CheckCircle2 className={`w-8 h-8 ${isDarkMode ? 'text-gray-700' : 'text-slate-300'} mx-auto mb-2`} />
                <p className={`text-xs ${isDarkMode ? 'text-gray-500' : 'text-slate-400'} uppercase tracking-widest`}>No active dispatches</p>
                <p className={`text-[10px] ${isDarkMode ? 'text-gray-600' : 'text-slate-300'} mt-1`}>Awaiting SOS Trigger</p>
              </div>
            )}
          </div>
        </div>

        {/* Footer/System Info */}
        <div className={`mt-8 border-t ${themeClasses.borderColor} pt-4 flex items-center justify-between text-[10px] ${themeClasses.textMuted} tracking-widest`}>
          <span className="flex items-center gap-1"><Navigation2 className="w-3 h-3" /> ResQDrive Core</span>
          <span>v2.4.1</span>
        </div>
      </div>

      <style>{`
        @keyframes pulse {
          0% {
            transform: scale(0.95);
            box-shadow: 0 0 0 0 rgba(255, 26, 26, 0.7);
          }
          70% {
            transform: scale(1);
            box-shadow: 0 0 0 20px rgba(255, 26, 26, 0);
          }
          100% {
            transform: scale(0.95);
            box-shadow: 0 0 0 0 rgba(255, 26, 26, 0);
          }
        }
        .crash-pulse {
          position: absolute;
          width: 100%;
          height: 100%;
          border-radius: 50%;
          animation: pulse 2s infinite;
          background-color: rgba(255, 26, 26, 0.2);
        }
        .animate-dash {
          stroke-dasharray: 10;
          animation: dash 20s linear infinite;
        }
        @keyframes dash {
          to {
            stroke-dashoffset: -1000;
          }
        }
      `}</style>
    </div>
  );
};

export default HospitalMapDashboard;
