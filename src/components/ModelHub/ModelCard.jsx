export function ModelCard({ children, onClick, className = '' }) {
  return (
    <div
      className={`bg-neutral-900/80 border border-neutral-800 hover:border-blue-500/30 rounded-xl overflow-hidden transition-all group h-full flex flex-col ${className}`}
      onClick={onClick}
    >
      {children}
    </div>
  );
}

export default ModelCard;
