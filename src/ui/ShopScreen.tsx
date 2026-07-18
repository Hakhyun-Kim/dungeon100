import { SHOP_ITEMS, shopCost, type Meta } from '../lib/meta';
import { ChoiceList } from './Menu';

// 대장간 (무크) — 코인으로 영구 강화 구매. 코인·강화는 죽어도 유지.
export default function ShopScreen({
  coins,
  meta,
  onBuy,
  onBack,
}: {
  coins: number;
  meta: Meta;
  onBuy: (key: keyof Meta) => void;
  onBack: () => void;
}) {
  return (
    <div className="screen town-screen">
      <div className="town-sky">🌙</div>
      <div className="town-scape">🔥 ⚒️ 🛠️ 🧱</div>
      <div className="dialog-box">
        <div className="dialog-speaker">
          <span className="dialog-icon">🧔</span> 대장장이 무크
        </div>
        <p className="dialog-text">
          "죽어도 몸에 남는 단련이지. 코인만 있으면 몇 번이고 벼려 주마."
        </p>
        <p className="shop-coins">보유 🪙 {coins}</p>
        <ChoiceList
          items={[
            ...SHOP_ITEMS.map((it) => {
              const lv = meta[it.key];
              const cost = shopCost(lv);
              return {
                key: it.key as string,
                className: 'shop-item',
                disabled: coins < cost,
                label: (
                  <>
                    <span>
                      {it.icon} {it.name} Lv.{lv}
                    </span>
                    <span className="shop-cost">{`${it.desc} · 🪙 ${cost}`}</span>
                  </>
                ),
                onPick: () => onBuy(it.key),
              };
            }),
            { key: 'back', label: '↩️ 마을로 돌아간다', onPick: onBack },
          ]}
        />
      </div>
    </div>
  );
}
