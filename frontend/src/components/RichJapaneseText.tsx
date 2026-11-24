import React from 'react';

interface RichJapaneseTextProps {
  text: string;
  vertical?: boolean;
  className?: string;
}

/**
 * テキスト記法パーサ:
 * - [漢字]{かんじ} -> <ruby>漢字<rt>かんじ</rt></ruby>
 * - ==対象==      -> 縦書き時は右傍線 / 横書き時は下線
 * - [[1]]         -> 空欄トークン
 */
export const RichJapaneseText: React.FC<RichJapaneseTextProps> = ({
  text,
  vertical = false,
  className = '',
}) => {
  if (!text) return null;

  const lines = text.split('\n');

  const renderInline = (line: string, lineKey: string): React.ReactNode[] => {
    const tokenRegex = /(\[[^\]]+\]\{[^}]+\}|==[^=]+==|<u>[^<]+<\/u>|\[\[[^\]]*\]\])/gi;
    const parts = line.split(tokenRegex);

    return parts.map((part, idx) => {
      const key = `${lineKey}-${idx}`;
      if (!part) return null;

      // [漢字]{かんじ}
      const rubyMatch = part.match(/^\[([^\]]+)\]\{([^}]+)\}$/);
      if (rubyMatch) {
        return (
          <ruby key={key}>
            {rubyMatch[1]}
            <rt>{rubyMatch[2]}</rt>
          </ruby>
        );
      }

      // ==傍線部== または <u>傍線部</u>
      const bosenMatch = part.match(/^==([^=]+)==$/) || part.match(/^<u>([^<]+)<\/u>$/i);
      if (bosenMatch) {
        return (
          <span key={key} className={vertical ? 'kokugo-bosen' : 'horizontal-bosen'}>
            {bosenMatch[1]}
          </span>
        );
      }

      // [[1]]
      const blankMatch = part.match(/^\[\[([^\]]*)\]\]$/);
      if (blankMatch) {
        const label = blankMatch[1].trim();
        if (vertical) {
          return (
            <span
              key={key}
              className="inline-block border border-black px-0.5 py-2 mx-0.5 text-xs align-middle"
            >
              {label ? <span className="tcy">{label}</span> : '　'}
            </span>
          );
        }
        return (
          <span key={key} className="blank-token">
            {label ? `(${label})` : '　　'}
          </span>
        );
      }

      // 縦書き時は2桁までの数字を縦中横にする
      if (vertical) {
        const numParts = part.split(/(\d{1,2})/g);
        return (
          <React.Fragment key={key}>
            {numParts.map((seg, sIdx) =>
              /^\d{1,2}$/.test(seg) ? (
                <span key={`${key}-n-${sIdx}`} className="tcy">
                  {seg}
                </span>
              ) : (
                seg
              )
            )}
          </React.Fragment>
        );
      }

      return <React.Fragment key={key}>{part}</React.Fragment>;
    });
  };

  return (
    <span className={className}>
      {lines.map((line, i) => (
        <React.Fragment key={i}>
          {renderInline(line, String(i))}
          {i < lines.length - 1 && <br />}
        </React.Fragment>
      ))}
    </span>
  );
};
