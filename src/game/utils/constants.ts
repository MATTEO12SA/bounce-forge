export const GAME_TITLE = 'Bounce Forge';

export const WORLD_WIDTH = 1080;
export const WORLD_HEIGHT = 1920;

export const PLAYFIELD_LEFT = 112;
export const PLAYFIELD_RIGHT = WORLD_WIDTH - 112;
export const PLAYFIELD_TOP = 38;
export const PLAYFIELD_BOTTOM = WORLD_HEIGHT - 34;
export const PLAYFIELD_WIDTH = PLAYFIELD_RIGHT - PLAYFIELD_LEFT;

export const PADDLE_WIDTH = 230;
export const PADDLE_HEIGHT = 22;
export const PADDLE_Y = WORLD_HEIGHT - 160;
export const PADDLE_SPEED = 1450;
export const PADDLE_MIN_WIDTH = 150;
export const PADDLE_MAX_WIDTH = 320;

export const BALL_RADIUS = 8;
export const BALL_START_SPEED = 540;
export const BALL_MIN_SPEED = 420;
export const BALL_MAX_SPEED = 960;
export const BALL_MAX_PADDLE_ANGLE_DEGREES = 58;
export const BALL_AXIS_LOCK_MIN_SPEED = 130;

export const BRICK_GAP = 3;
export const BRICK_HEIGHT = 19;
export const LEVEL_TOP_PADDING = 70;
export const LEVEL_HORIZONTAL_PADDING = PLAYFIELD_LEFT + 20;

export const STARTING_LIVES = 3;
export const MAX_LIVES = 5;
/** Admin tools may go past the normal cap. */
export const ADMIN_MAX_LIVES = 9;
export const COMBO_TIMEOUT_MS = 2200;

export const POWER_UP_DROP_SPEED = 320;
export const INITIAL_ACTIVE_BALL_LIMIT = 40;
export const MAX_ACTIVE_BALLS = 96;
export const BALL_LIMIT_GROWTH_STEP = 8;
export const BALL_LIMIT_STRESS_FRAME_MS = 34;
export const BALL_LIMIT_STRESS_FRAMES = 10;
export const MAX_ACTIVE_PARTICLES = 160;

export const SAVE_STORAGE_KEY = 'bounce-forge.save.v1';

export const DEPTHS = {
  background: 0,
  bricks: 10,
  powerUps: 20,
  paddle: 30,
  ball: 35,
  particles: 45,
  hud: 60,
  overlay: 100
} as const;
