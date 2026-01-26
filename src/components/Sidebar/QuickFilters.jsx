import React, { memo } from 'react';
import { motion } from 'framer-motion';
import { 
  LayoutGrid, 
  Calendar, 
  CalendarDays,
  Star, 
  Pin 
} from 'lucide-react';
import { useAppStore } from '../../stores/appStore';

// Filter configuration
const FILTERS = [
  { id: 'all', label: 'All', icon: LayoutGrid },
  { id: 'today', label: 'Today', icon: Calendar },
  { id: 'week', label: 'Week', icon: CalendarDays },
  { id: 'starred', label: 'Starred', icon: Star },
  { id: 'pinned', label: 'Pinned', icon: Pin },
];

// Single filter pill
const FilterPill = memo(function FilterPill({ filter, isActive, count, onClick }) {
  const Icon = filter.icon;
  
  return (
    <motion.button
      whileHover={{ scale: 1.02 }}
      whileTap={{ scale: 0.98 }}
      onClick={() => onClick(filter.id)}
      className={`
        relative flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium
        transition-colors whitespace-nowrap
        ${isActive 
          ? 'bg-accent-primary/20 text-accent-primary border border-accent-primary/30' 
          : 'text-text-muted hover:text-text-secondary hover:bg-glass-2 border border-transparent'
        }
      `}
    >
      <Icon size={13} className={isActive ? 'text-accent-primary' : ''} />
      <span>{filter.label}</span>
      
      {/* Count badge - only show for specific filters when active */}
      {isActive && count > 0 && (
        <span className="ml-1 px-1.5 py-0.5 text-[10px] bg-accent-primary/30 rounded-full">
          {count}
        </span>
      )}
    </motion.button>
  );
});

// Main QuickFilters component
export function QuickFilters({ className = '' }) {
  const activeFilter = useAppStore(s => s.activeFilter);
  const setActiveFilter = useAppStore(s => s.setActiveFilter);
  const conversations = useAppStore(s => s.conversations);
  const setActiveFolder = useAppStore(s => s.setActiveFolder);

  // Calculate counts for each filter
  const counts = React.useMemo(() => {
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const startOfWeek = new Date(startOfToday);
    startOfWeek.setDate(startOfWeek.getDate() - 7);
    
    const convs = conversations || [];
    
    return {
      all: convs.length,
      today: convs.filter(c => new Date(c.updated_at) >= startOfToday).length,
      week: convs.filter(c => new Date(c.updated_at) >= startOfWeek).length,
      starred: convs.filter(c => c.starred === 1).length,
      pinned: convs.filter(c => c.pinned === 1).length,
    };
  }, [conversations]);

  const handleFilterClick = (filterId) => {
    setActiveFilter(filterId);
    // Clear folder selection when using quick filters
    setActiveFolder(null);
  };

  return (
    <div className={`flex items-center gap-1 overflow-x-auto scrollbar-none py-1 ${className}`}>
      {FILTERS.map((filter) => (
        <FilterPill
          key={filter.id}
          filter={filter}
          isActive={activeFilter === filter.id}
          count={counts[filter.id]}
          onClick={handleFilterClick}
        />
      ))}
    </div>
  );
}

// Compact version for collapsed sidebar
export function QuickFiltersCompact({ className = '' }) {
  const activeFilter = useAppStore(s => s.activeFilter);
  const setActiveFilter = useAppStore(s => s.setActiveFilter);
  const setActiveFolder = useAppStore(s => s.setActiveFolder);

  const handleFilterClick = (filterId) => {
    setActiveFilter(filterId);
    setActiveFolder(null);
  };

  return (
    <div className={`flex flex-col items-center gap-1 ${className}`}>
      {FILTERS.slice(0, 4).map((filter) => {
        const Icon = filter.icon;
        const isActive = activeFilter === filter.id;
        
        return (
          <button
            key={filter.id}
            onClick={() => handleFilterClick(filter.id)}
            className={`
              w-9 h-9 flex items-center justify-center rounded-lg transition-colors
              ${isActive 
                ? 'bg-accent-primary/20 text-accent-primary' 
                : 'text-text-muted hover:text-text-secondary hover:bg-glass-2'
              }
            `}
            title={filter.label}
          >
            <Icon size={16} />
          </button>
        );
      })}
    </div>
  );
}

export default QuickFilters;


