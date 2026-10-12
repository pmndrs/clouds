// HZD bench on React + R3F v10 (work/specs/hzd-react.md): the same sky, views, URL, references, tuning panel, painter and capture contract
// as the vanilla bench (../hzd/), with the controls in React (shadcn) and the sky hosted by an R3F <Canvas>. Built beside the vanilla page
// until it reaches parity; then it takes over the hzd/ route.
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { installCloudsHarness } from '../harness/clouds-contract';
import { App } from './app/App';
import './ui/globals.css';

const harness = installCloudsHarness();
createRoot(document.getElementById('root')!).render(<StrictMode><App harness={harness} /></StrictMode>);
