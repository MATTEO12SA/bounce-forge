import './style.css';
import { App } from './ui/app';

const root = document.querySelector<HTMLElement>('#app');

if (!root) {
  throw new Error('Missing #app element');
}

const app = new App(root);
app.start();

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    app.destroy();
  });
}
