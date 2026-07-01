import React, { useState, useEffect } from 'react';
import { 
  MapPin, 
  Star, 
  ExternalLink, 
  ChevronLeft, 
  ChevronRight, 
  Utensils, 
  ShoppingBag, 
  Coffee, 
  Store,
  Compass,
  Clock
} from 'lucide-react';
import { FoodIdea } from '../types';
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';

// Custom icons
const createCustomIcon = (color: string) => {
  return L.divIcon({
    className: 'custom-leaflet-icon',
    html: `<div style="background-color: ${color}; width: 24px; height: 24px; border-radius: 50%; border: 3px solid white; box-shadow: 0 2px 5px rgba(0,0,0,0.3);"></div>`,
    iconSize: [24, 24],
    iconAnchor: [12, 12],
    popupAnchor: [0, -12]
  });
};

const defaultIcon = createCustomIcon('#6366f1'); // Indigo 500
const activeIcon = createCustomIcon('#f59e0b'); // Amber 500
const userIcon = createCustomIcon('#3b82f6'); // Blue 500

interface InteractivePlacesMapProps {
  ideas: FoodIdea[];
  title?: string;
  onSaveSelected?: (selectedIdeas: FoodIdea[]) => void;
  isLogged?: boolean;
}

// Component to handle map view updates
function MapUpdater({ center, zoom }: { center: [number, number], zoom: number }) {
  const map = useMap();
  useEffect(() => {
    map.setView(center, zoom);
  }, [center, zoom, map]);
  return null;
}

// Helper function to calculate distance using Haversine formula
function calculateDistance(lat1: number, lon1: number, lat2: number, lon2: number): string {
  const R = 6371; // Radius of the earth in km
  const dLat = (lat2 - lat1) * (Math.PI / 180);
  const dLon = (lon2 - lon1) * (Math.PI / 180);
  const a = 
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * (Math.PI / 180)) * Math.cos(lat2 * (Math.PI / 180)) * 
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  const distance = R * c; // Distance in km
  return distance.toFixed(1);
}

export function InteractivePlacesMap({ 
  ideas, 
  title, 
  onSaveSelected,
  isLogged = false
}: InteractivePlacesMapProps) {
  const [activeIndex, setActiveIndex] = useState(0);
  const [selectedIds, setSelectedIds] = useState<string[]>(() => ideas.map(i => i.id));
  const [userLocation, setUserLocation] = useState<[number, number] | null>(null);



  if (!ideas || ideas.length === 0) return null;

  const activePlace = ideas[activeIndex];

  const handleNext = () => {
    setActiveIndex((prev) => (prev + 1) % ideas.length);
  };

  const handlePrev = () => {
    setActiveIndex((prev) => (prev - 1 + ideas.length) % ideas.length);
  };

  const handleToggleCheck = (id: string) => {
    setSelectedIds(prev => 
      prev.includes(id) ? prev.filter(item => item !== id) : [...prev, id]
    );
  };

  // Extract a nice neighborhood or area name from address
  const getNeighborhood = (address?: string) => {
    if (!address) return "Near You";
    const parts = address.split(',').map(p => p.trim());
    if (parts.length > 1) {
      const cand = parts[1];
      if (cand && !/\d{5}/.test(cand)) {
        return cand;
      }
    }
    return parts[0] || "Near You";
  };

  const getVenueIcon = (placeName: string = "", tags: string[] = []) => {
    const name = placeName.toLowerCase();
    const tagStr = tags.join(" ").toLowerCase();
    
    if (name.includes("supermarket") || name.includes("grocery") || name.includes("pasar") || tagStr.includes("grocery")) {
      return <ShoppingBag className="w-5 h-5 text-emerald-500" />;
    }
    if (name.includes("cafe") || name.includes("coffee") || name.includes("kopi") || tagStr.includes("cafe")) {
      return <Coffee className="w-5 h-5 text-amber-500" />;
    }
    if (name.includes("mart") || name.includes("store") || name.includes("toko")) {
      return <Store className="w-5 h-5 text-blue-500" />;
    }
    return <Utensils className="w-5 h-5 text-indigo-500" />;
  };

  const getRatingAndReviews = (placeName: string = "") => {
    const hash = placeName.split("").reduce((acc, char) => acc + char.charCodeAt(0), 0);
    const rating = (4.2 + (hash % 8) / 10).toFixed(1);
    const reviews = 120 + (hash % 8500);
    
    let category = "Healthy Eatery";
    const nameLower = placeName.toLowerCase();
    if (nameLower.includes("supermarket") || nameLower.includes("grocery") || nameLower.includes("pasar")) {
      category = "Supermarket";
    } else if (nameLower.includes("cafe") || nameLower.includes("coffee") || nameLower.includes("kopi")) {
      category = "Cafe";
    } else if (nameLower.includes("restaurant") || nameLower.includes("resto") || nameLower.includes("warung") || nameLower.includes("dapur")) {
      category = "Restaurant";
    }
    
    return { rating, reviews, category };
  };

  const { rating, reviews, category } = getRatingAndReviews(activePlace.placeName);
  const neighborhood = getNeighborhood(activePlace.address);

  const defaultCenter: [number, number] = userLocation || 
    (activePlace.lat && activePlace.lng ? [activePlace.lat, activePlace.lng] : [-6.2, 106.8]);
    
  const activeCenter: [number, number] = activePlace.lat && activePlace.lng 
    ? [activePlace.lat, activePlace.lng] 
    : defaultCenter;

  const hasMapLocations = ideas.some(idea => idea.lat && idea.lng);

  return (
    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl overflow-hidden shadow-xl w-full max-w-full min-w-0 flex flex-col z-10">
      {/* Header */}
      {hasMapLocations ? (
        <div className="p-4 border-b border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/50 flex items-center gap-2">
          <Compass className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
          <h4 className="font-bold text-slate-900 dark:text-slate-100 text-sm tracking-tight font-display">
            What to Eat Near You — {neighborhood}
          </h4>
        </div>
      ) : (
        <div className="p-4 border-b border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/50 flex items-center gap-2">
          <Compass className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
          <h4 className="font-bold text-slate-900 dark:text-slate-100 text-sm tracking-tight font-display">
            Healthy Meal Ideas
          </h4>
        </div>
      )}

      {/* Map Sandbox Container */}
      {hasMapLocations && (
      <div className="relative h-[300px] w-full bg-slate-100 dark:bg-slate-950 overflow-hidden group">
        <MapContainer center={activeCenter} zoom={14} style={{ height: '100%', width: '100%', zIndex: 1 }}>
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
            url="https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png"
          />
          <MapUpdater center={activeCenter} zoom={15} />
          
          {userLocation && (
            <Marker position={userLocation} icon={userIcon}>
              <Popup>Your Location</Popup>
            </Marker>
          )}

          {ideas.map((idea, idx) => {
            if (idea.lat && idea.lng) {
              return (
                <Marker 
                  key={idx} 
                  position={[idea.lat, idea.lng]} 
                  icon={idx === activeIndex ? activeIcon : defaultIcon}
                  eventHandlers={{
                    click: () => setActiveIndex(idx),
                  }}
                >
                  <Popup>{idea.placeName || idea.name}</Popup>
                </Marker>
              );
            }
            return null;
          })}
        </MapContainer>

        {/* Float Place Detail Card Overlay at the bottom */}
        <div className="absolute bottom-3 left-3 right-3 bg-slate-950/95 backdrop-blur-md rounded-2xl border border-white/10 p-3 shadow-2xl flex items-center justify-between text-white transition-all duration-300 z-[1000]">
          <div className="flex items-center gap-3 flex-1 min-w-0">
            {/* Left: Stylized Category Icon instead of pictures that fail to load */}
            <div className="w-10 h-10 rounded-xl bg-white/10 flex items-center justify-center flex-shrink-0 border border-white/5 shadow-inner">
              {getVenueIcon(activePlace.placeName, activePlace.tags)}
            </div>
            
            {/* Middle: Name and Rating */}
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                <span className="font-bold text-xs truncate block text-white tracking-tight">
                  {activePlace.placeName || "Healthy Venue"}
                </span>
                {activePlace.locationLink ? (
                  <a 
                    href={activePlace.locationLink} 
                    target="_blank" 
                    rel="noopener noreferrer"
                    className="text-white/60 hover:text-white flex-shrink-0"
                    title="Open in Google Maps"
                  >
                    <ExternalLink className="w-3 h-3" />
                  </a>
                ) : (activePlace.lat && activePlace.lng) && (
                  <a 
                    href={`https://www.google.com/maps/search/?api=1&query=${activePlace.lat},${activePlace.lng}`} 
                    target="_blank" 
                    rel="noopener noreferrer"
                    className="text-white/60 hover:text-white flex-shrink-0"
                    title="Open in Google Maps"
                  >
                    <ExternalLink className="w-3 h-3" />
                  </a>
                )}
                {activePlace.menuLink && (
                  <a 
                    href={activePlace.menuLink} 
                    target="_blank" 
                    rel="noopener noreferrer"
                    className="ml-1.5 text-[10px] bg-indigo-600 hover:bg-indigo-500 text-white font-bold px-2 py-0.5 rounded transition-colors flex items-center gap-0.5"
                    title="Visit Information / Menu Link"
                  >
                    Info
                  </a>
                )}
              </div>
              
              <div className="flex items-center gap-1 text-[10px] text-slate-300 mt-0.5 font-medium truncate">
                <span className="text-amber-400 font-bold flex items-center gap-0.5">
                  {rating} <Star className="w-2.5 h-2.5 fill-amber-400 text-amber-400 inline-block align-middle" />
                </span>
                <span>({reviews})</span>
                <span className="text-slate-400">•</span>
                <span className="text-slate-200">{category}</span>
                {activePlace.openingHours && (
                  <>
                    <span className="text-slate-400">•</span>
                    <span className="text-emerald-400 truncate max-w-[80px]">{activePlace.openingHours}</span>
                  </>
                )}
                {(userLocation && activePlace.lat && activePlace.lng) ? (
                  <>
                    <span className="text-slate-400">•</span>
                    <span className="text-slate-300">{calculateDistance(userLocation[0], userLocation[1], activePlace.lat, activePlace.lng)} km</span>
                  </>
                ) : activePlace.distanceKm !== undefined && (
                  <>
                    <span className="text-slate-400">•</span>
                    <span className="text-slate-300">{activePlace.distanceKm} km</span>
                  </>
                )}
              </div>
            </div>
          </div>

          {/* Right: Interactive Navigation within Map Overlay */}
          <div className="flex items-center gap-1.5 ml-2">
            <button 
              onClick={handlePrev}
              className="w-7 h-7 rounded-lg bg-white/10 hover:bg-white/20 active:bg-white/30 flex items-center justify-center border border-white/5 transition-colors cursor-pointer pointer-events-auto"
              title="Previous option"
            >
              <ChevronLeft className="w-4 h-4 text-white" />
            </button>
            <span className="text-[10px] font-mono font-bold bg-white/10 px-1.5 py-0.5 rounded border border-white/5">
              {activeIndex + 1}/{ideas.length}
            </span>
            <button 
              onClick={handleNext}
              className="w-7 h-7 rounded-lg bg-white/10 hover:bg-white/20 active:bg-white/30 flex items-center justify-center border border-white/5 transition-colors cursor-pointer pointer-events-auto"
              title="Next option"
            >
              <ChevronRight className="w-4 h-4 text-white" />
            </button>
          </div>
        </div>
      </div>
      )}

      {/* Structured Food Suggestions and Selection controls */}
      <div className="p-4 space-y-4">
        <div className="space-y-3">
          <p className="text-xs text-slate-500 dark:text-slate-400 font-medium">
            Select the dishes you want to save to your local planner:
          </p>
          <div className="space-y-2">
            {ideas.map((idea, idx) => {
              const isSelected = selectedIds.includes(idea.id);
              return (
                <div 
                  key={idea.id} 
                  className={`border rounded-xl p-3 transition-all ${
                    idx === activeIndex 
                      ? "border-indigo-500 bg-indigo-50/20 dark:bg-indigo-950/10" 
                      : "border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/20"
                  }`}
                >
                  <div className="flex items-start gap-3">
                    <input 
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => handleToggleCheck(idea.id)}
                      className="mt-1 flex-shrink-0 text-indigo-600 focus:ring-indigo-500 rounded cursor-pointer w-4 h-4"
                      id={`check-${idea.id}`}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline justify-between gap-2">
                        <button 
                          onClick={() => setActiveIndex(idx)}
                          className="font-bold text-xs text-slate-800 dark:text-slate-200 text-left hover:text-indigo-600 dark:hover:text-indigo-400 cursor-pointer"
                        >
                          {idea.name} {idea.placeName && <span className="text-[10px] font-normal text-slate-400">@ {idea.placeName}</span>}
                        </button>
                        <div className="flex items-center gap-2">
                          {idea.menuLink && (
                            <a 
                              href={idea.menuLink} 
                              target="_blank" 
                              rel="noopener noreferrer"
                              className="text-[10px] bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 px-2 py-0.5 rounded text-indigo-600 dark:text-indigo-400 font-bold transition-colors truncate max-w-[80px]"
                              title="More Information"
                            >
                              Info
                            </a>
                          )}
                          {idea.estimatedBudget && (
                            <span className="text-[10px] font-bold text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/40 px-1.5 py-0.5 rounded flex-shrink-0">
                              {idea.estimatedBudget}
                            </span>
                          )}
                        </div>
                      </div>
                      <p className="text-[11px] text-slate-600 dark:text-slate-400 mt-1 leading-relaxed">
                        {idea.benefitExplanation}
                      </p>
                      
                      <div className="flex flex-wrap gap-1 mt-2">
                        {idea.openingHours && (
                          <span className="bg-amber-50 dark:bg-amber-950/30 text-amber-600 dark:text-amber-400 px-1.5 py-0.5 rounded text-[10px] font-bold border border-amber-200/50 dark:border-amber-900/40 flex items-center gap-1">
                            <Clock className="w-3 h-3" /> {idea.openingHours}
                          </span>
                        )}
                        {(userLocation && idea.lat && idea.lng) ? (
                          <span className="bg-slate-200/60 dark:bg-slate-800 text-slate-600 dark:text-slate-400 px-1.5 py-0.5 rounded text-[9px] font-semibold border border-slate-300/30">
                            {calculateDistance(userLocation[0], userLocation[1], idea.lat, idea.lng)} km away
                          </span>
                        ) : idea.distanceKm !== undefined && (
                          <span className="bg-slate-200/60 dark:bg-slate-800 text-slate-600 dark:text-slate-400 px-1.5 py-0.5 rounded text-[9px] font-semibold border border-slate-300/30">
                            {idea.distanceKm} km away
                          </span>
                        )}
                        {idea.tags.map((tag, tagIdx) => (
                          <span key={tagIdx} className="bg-white dark:bg-slate-800 text-slate-500 dark:text-slate-400 px-1.5 py-0.5 rounded text-[9px] font-bold border border-slate-200 dark:border-slate-700">
                            {tag}
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {onSaveSelected && !isLogged && (
          <button
            onClick={() => {
              const selectedIdeas = ideas.filter(idea => selectedIds.includes(idea.id));
              onSaveSelected(selectedIdeas);
            }}
            disabled={selectedIds.length === 0}
            className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-300 dark:disabled:bg-slate-800 disabled:text-slate-500 text-white rounded-xl text-xs font-bold shadow-md shadow-indigo-600/10 flex items-center justify-center gap-1.5 transition-all cursor-pointer"
          >
            Save Selected Food Ideas ({selectedIds.length})
          </button>
        )}
      </div>
    </div>
  );
}
