/**
 * WEIGHT SLIDER - Interactive Ranking Control
 *
 * Provides slider UI for adjusting column weights in ranking calculation.
 * Each metric (price, debt, etc.) can be weighted 0-1 to influence ranking.
 *
 * CRITICAL: Weight changes trigger re-ranking of all stocks
 */

function WeightSlider({ label, value, name, onChange }) {
  return (
    <div>
      <label>
        {label} ({value}){' '}
        <input
          type="range"
          value={value}
          min="0"
          max="1"
          step="0.05"
          name={name}
          onChange={onChange}
        />
      </label>
    </div>
  );
}

export default WeightSlider;
