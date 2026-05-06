import './style.css';
import { GameApp } from './game/GameApp';

const root = document.querySelector<HTMLElement>('#game-root');

if (!root) {
  throw new Error('Missing #game-root element');
}

const app = new GameApp(root);
app.start();

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    app.destroy();
  });
}
