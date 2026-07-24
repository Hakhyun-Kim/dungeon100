// 강제 가로 모드 — 시스템 화면 회전 잠금이 걸려 있어도 기기를 눕히면 게임을 돌린다.
// 기울기 센서(devicemotion 중력 벡터)로 물리 방향을 감지해, 브라우저 뷰포트는
// 세로로 잠긴 채 UI(.app)만 CSS로 90° 회전시킨다 (App이 클래스 부여).
// - 안드로이드 크롬: devicemotion은 https에서 권한 없이 동작.
// - iOS 사파리: requestPermission 제스처 팝업이 필요해 자동 활성화하지 않음
//   (센서 이벤트가 안 오면 그냥 꺼진 상태 — 기능이 조용히 비활성).
// - 뷰포트가 이미 가로면(회전 잠금 해제·데스크톱) 아무것도 안 함.
// 입력 훅(useMoveInput·useSteer)은 appRotation()으로 현재 회전을 읽어
// 손가락 좌표를 화면(콘텐츠) 기준으로 변환한다.

export type AppRotation = 0 | 90 | -90; // 콘텐츠에 적용된 CSS 회전 (90 = 시계 방향)

let current: AppRotation = 0;
export const appRotation = (): AppRotation => current;

const STABLE_N = 10; // 60Hz 기준 ≈ 0.17초 연속 같은 판정이어야 전환 (순간 기울임 무시)

export function initAutoRotate(onChange: (rot: AppRotation) => void): () => void {
  if (!('DeviceMotionEvent' in window)) return () => {};

  let pending: AppRotation = 0;
  let streak = 0;

  const apply = (rot: AppRotation) => {
    if (rot === current) return;
    current = rot;
    onChange(rot);
  };

  const onMotion = (e: DeviceMotionEvent) => {
    // 뷰포트가 이미 가로면(잠금 해제 상태거나 데스크톱) 강제 회전 불필요
    if (window.innerWidth > window.innerHeight) {
      streak = 0;
      apply(0);
      return;
    }
    const g = e.accelerationIncludingGravity;
    if (!g || g.x == null || g.y == null) return;
    // 중력이 화면 평면에 충분히 실릴 때만 판정 (책상에 눕히면 마지막 상태 유지)
    if (Math.hypot(g.x, g.y) < 4.5) return;
    // φ: 기기가 똑바로 세운 상태에서 시계 방향으로 돌아간 각도 (도)
    const phi = (Math.atan2(-g.x, g.y) * 180) / Math.PI;
    const a = Math.abs(phi);
    // 히스테리시스: 55° 넘게 눕히면 가로, 35° 안쪽이면 세로, 그 사이는 유지
    let want: AppRotation | null = null;
    if (a > 55 && a < 125) want = phi > 0 ? -90 : 90; // 기기 CW로 돌림 → 콘텐츠는 CCW로 보정
    else if (a < 35 || a > 145) want = 0; // 거꾸로(180°)는 미지원 — 세로 취급
    if (want === null) {
      streak = 0;
      return;
    }
    if (want === pending) streak++;
    else {
      pending = want;
      streak = 1;
    }
    if (streak >= STABLE_N) apply(want);
  };

  const onResize = () => {
    // 브라우저가 실제로 가로로 회전했으면(자동 회전 허용 상태) 즉시 원복
    if (window.innerWidth > window.innerHeight) apply(0);
  };

  window.addEventListener('devicemotion', onMotion);
  window.addEventListener('resize', onResize);
  return () => {
    window.removeEventListener('devicemotion', onMotion);
    window.removeEventListener('resize', onResize);
    current = 0;
  };
}
