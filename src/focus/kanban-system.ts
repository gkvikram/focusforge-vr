import {
  BoxGeometry,
  CanvasTexture,
  Color,
  createSystem,
  Entity,
  Grabbed,
  Hovered,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  OneHandGrabbable,
  Pressed,
  Quaternion,
  RayInteractable,
  SRGBColorSpace,
  UIKitMLAsset,
  Vector3,
} from '@iwsdk/core';
import { soundEngine } from '../audio/SoundEngine.js';
import { pointerGesture } from '../mobile/MobileControls.js';
import { DOING, DONE, focusStore, MAX_LIVE_TASKS, TaskState, TODO } from './focus-store.js';
import {
  CARD_COLUMN_SPAN,
  CARD_DEPTH,
  CARD_HEIGHT,
  CARD_RADIUS,
  CARD_SLOT_STEP,
  CARD_SLOT_TOP_Y,
  CARD_WIDTH,
  COLUMN_ANGLES,
  COLUMN_HEADER_Y,
  COLUMN_TITLES,
  polarX,
  polarZ,
  WORKSPACE_Y,
} from './layout.js';
import { AddTaskButton, TaskCard } from './task-card-component.js';

const ADD_BUTTON_Y = WORKSPACE_Y + 0.24;
const ADD_BUTTON_HEIGHT = 0.048;
const ADD_TEXTURE_WIDTH = 512;
const ADD_TEXTURE_HEIGHT = Math.round((ADD_TEXTURE_WIDTH * ADD_BUTTON_HEIGHT) / CARD_WIDTH);
const ADD_COOLDOWN_MS = 350;

const COLUMN_COLORS = ['#cfae86', '#f2a03d', '#7fae8a'];
const COLUMN_TAGS = ['TO-DO', 'DOING', 'DONE'];
const COLUMN_HINTS = ['Tap or grab to start', 'Focusing - tap to finish', 'Completed'];
const TEXTURE_WIDTH = 512;
const TEXTURE_HEIGHT = Math.round((TEXTURE_WIDTH * CARD_HEIGHT) / CARD_WIDTH);
const ADVANCE_COOLDOWN_MS = 600;
const QUICK_TAP_MS = 350;
const CARD_FONT = '"DM Sans", system-ui, sans-serif';

interface CardView {
  entity: Entity;
  task: TaskState;
  context: CanvasRenderingContext2D;
  texture: CanvasTexture;
  edgeMaterial: MeshStandardMaterial;
  targetPosition: Vector3;
  targetQuaternion: Quaternion;
  grabbed: boolean;
  pressStartedAt: number;
  lastAdvanceAt: number;
}

interface ColumnHeader {
  count: { setProperties(props: { text: string }): void } | null;
}

function drawCard(context: CanvasRenderingContext2D, task: TaskState): void {
  const w = TEXTURE_WIDTH;
  const h = TEXTURE_HEIGHT;
  context.clearRect(0, 0, w, h);
  context.fillStyle = task.column === DONE ? '#f1f5ee' : '#fffaf2';
  context.fillRect(0, 0, w, h);

  context.fillStyle = COLUMN_COLORS[task.column];
  context.fillRect(0, 0, 22, h);

  context.fillStyle = COLUMN_COLORS[task.column];
  context.beginPath();
  context.roundRect(52, 34, 124, 40, 20);
  context.fill();
  context.fillStyle = '#3b2a1f';
  context.font = `700 22px ${CARD_FONT}`;
  context.textBaseline = 'middle';
  context.textAlign = 'center';
  context.fillText(COLUMN_TAGS[task.column], 114, 55);

  context.textAlign = 'left';
  let size = 54;
  context.font = `700 ${size}px ${CARD_FONT}`;
  while (context.measureText(task.title).width > w - 90 && size > 30) {
    size -= 2;
    context.font = `700 ${size}px ${CARD_FONT}`;
  }
  context.fillStyle = task.column === DONE ? '#6f7f70' : '#3b2a1f';
  context.fillText(task.title, 52, h * 0.55);
  if (task.column === DONE) {
    const width = context.measureText(task.title).width;
    context.fillRect(52, h * 0.55, width, 4);
  }

  context.font = `500 24px ${CARD_FONT}`;
  context.fillStyle = '#8a6f58';
  context.fillText(COLUMN_HINTS[task.column], 52, h * 0.82);
}

export class KanbanSystem extends createSystem({
  cards: { required: [TaskCard] },
  pressedCards: { required: [TaskCard, Pressed] },
  grabbedCards: { required: [TaskCard, Grabbed] },
  pressedAdd: { required: [AddTaskButton, Pressed] },
}) {
  private addContext: CanvasRenderingContext2D | null = null;
  private addTexture: CanvasTexture | null = null;
  private addLabelKey = '';
  private addPressStartedAt = 0;
  private lastAddAt = 0;
  private views = new Map<Entity, CardView>();
  private viewList: CardView[] = [];
  private headers: ColumnHeader[] = [];
  private helper = new Object3D();
  private origin = new Vector3();
  private baseEmissive = new Color(0x000000);
  private activeEmissive = new Color(0xf2a03d);
  private elapsed = 0;

  init(): void {
    focusStore.liveTasks().forEach((task) => this.createCard(task));
    this.layoutCards(true);
    this.createAddButton();
    void this.createHeaders();

    this.cleanupFuncs.push(
      focusStore.subscribe((event) => {
        if (event?.kind === 'blocked') return;
        if (event?.kind === 'add') {
          this.createCard(event.task, true);
        } else if (event?.kind === 'remove') {
          this.removeCard(event.task);
        }
        this.layoutCards(false);
        for (const view of this.viewList) {
          drawCard(view.context, view.task);
          view.texture.needsUpdate = true;
        }
        this.updateCounts();
        this.drawAddButton();
      }),
      this.queries.pressedAdd.subscribe('qualify', () => {
        this.addPressStartedAt = performance.now();
      }),
      this.queries.pressedAdd.subscribe('disqualify', (entity) => {
        if (pointerGesture.dragged) return;
        const now = performance.now();
        const quickTap = now - this.addPressStartedAt < QUICK_TAP_MS;
        if (!entity.hasComponent(Hovered) && !quickTap) return;
        if (now - this.lastAddAt < ADD_COOLDOWN_MS) return;
        this.lastAddAt = now;
        if (focusStore.addPresetTask() != null) soundEngine.cardMove();
      }),
      this.queries.pressedCards.subscribe('qualify', (entity) => {
        const view = this.views.get(entity);
        if (view) view.pressStartedAt = performance.now();
      }),
      this.queries.pressedCards.subscribe('disqualify', (entity) => {
        const view = this.views.get(entity);
        if (view == null || view.grabbed || pointerGesture.dragged) return;
        const quickTap = performance.now() - view.pressStartedAt < QUICK_TAP_MS;
        // A ray that slides off the card without releasing is not a click.
        if (!entity.hasComponent(Hovered) && !quickTap) return;
        this.tryAdvance(view);
      }),
      this.queries.grabbedCards.subscribe('qualify', (entity) => {
        const view = this.views.get(entity);
        if (view) view.grabbed = true;
      }),
      this.queries.grabbedCards.subscribe('disqualify', (entity) => {
        const view = this.views.get(entity);
        if (view == null) return;
        view.grabbed = false;
        if (!this.tryAdvance(view)) {
          this.layoutCards(false);
        }
      }),
    );

    // Canvas text may render with a fallback font before DM Sans loads.
    document.fonts?.ready.then(() => {
      for (const view of this.viewList) {
        drawCard(view.context, view.task);
        view.texture.needsUpdate = true;
      }
    });
  }

  update(delta: number): void {
    this.elapsed += delta;
    const blend = 1 - Math.exp(-delta * 9);
    const active = focusStore.activeTask();
    const pulse = 0.55 + 0.45 * Math.sin(this.elapsed * 3.2);

    for (const view of this.viewList) {
      const object = view.entity.object3D;
      if (object == null) continue;
      if (!view.grabbed) {
        object.position.lerp(view.targetPosition, blend);
        object.quaternion.slerp(view.targetQuaternion, blend);
      }
      const isActive = active != null && view.task.id === active.id;
      view.edgeMaterial.emissive.copy(isActive ? this.activeEmissive : this.baseEmissive);
      view.edgeMaterial.emissiveIntensity = isActive ? 0.4 + pulse * 0.9 : 0;
    }
  }

  private tryAdvance(view: CardView): boolean {
    const now = performance.now();
    if (now - view.lastAdvanceAt < ADVANCE_COOLDOWN_MS) return false;
    if (focusStore.isStartBlocked(view.task.id)) {
      view.lastAdvanceAt = now;
      soundEngine.softTone();
      focusStore.notifyBlocked(view.task.id);
      return false;
    }
    if (!focusStore.advance(view.task.id)) return false;
    view.lastAdvanceAt = now;
    return true;
  }

  private createAddButton(): void {
    const canvas = document.createElement('canvas');
    canvas.width = ADD_TEXTURE_WIDTH;
    canvas.height = ADD_TEXTURE_HEIGHT;
    this.addContext = canvas.getContext('2d');
    this.addTexture = new CanvasTexture(canvas);
    this.addTexture.colorSpace = SRGBColorSpace;
    this.addTexture.anisotropy = 4;

    const edgeMaterial = new MeshStandardMaterial({ color: 0xc57a1c, roughness: 0.6 });
    const faceMaterial = new MeshStandardMaterial({
      map: this.addTexture,
      emissiveMap: this.addTexture,
      emissive: 0xffffff,
      emissiveIntensity: 0.45,
      roughness: 0.7,
    });
    const mesh = new Mesh(new BoxGeometry(CARD_WIDTH, ADD_BUTTON_HEIGHT, CARD_DEPTH), [
      edgeMaterial,
      edgeMaterial,
      edgeMaterial,
      edgeMaterial,
      faceMaterial,
      edgeMaterial,
    ]);
    mesh.name = 'Add Task Button';
    const angle = COLUMN_ANGLES[TODO];
    const radius = CARD_RADIUS + 0.005;
    mesh.position.set(polarX(angle, radius), ADD_BUTTON_Y, polarZ(angle, radius));
    mesh.lookAt(0, ADD_BUTTON_Y, 0);

    const entity = this.world.createTransformEntity(mesh, { persistent: true });
    entity.addComponent(AddTaskButton);
    entity.addComponent(RayInteractable);
    this.drawAddButton();
  }

  private drawAddButton(): void {
    const context = this.addContext;
    if (context == null || this.addTexture == null) return;
    const full = focusStore.liveTasks().length >= MAX_LIVE_TASKS;
    const key = String(full);
    if (key === this.addLabelKey) return;
    this.addLabelKey = key;

    const w = ADD_TEXTURE_WIDTH;
    const h = ADD_TEXTURE_HEIGHT;
    context.clearRect(0, 0, w, h);
    context.fillStyle = full ? '#8a7a6a' : '#f2a03d';
    context.beginPath();
    context.roundRect(0, 0, w, h, h / 2);
    context.fill();
    context.fillStyle = '#3b2a1f';
    context.font = `700 ${Math.round(h * 0.52)}px ${CARD_FONT}`;
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText(full ? 'Board full' : '+ Add Task', w / 2, h / 2 + 2);
    this.addTexture.needsUpdate = true;
  }

  private removeCard(task: TaskState): void {
    const index = this.viewList.findIndex((view) => view.task.id === task.id);
    if (index < 0) return;
    const [view] = this.viewList.splice(index, 1);
    this.views.delete(view.entity);
    view.texture.dispose();
    view.edgeMaterial.dispose();
    view.entity.dispose();
  }

  private createCard(task: TaskState, spawnAtButton = false): void {
    const canvas = document.createElement('canvas');
    canvas.width = TEXTURE_WIDTH;
    canvas.height = TEXTURE_HEIGHT;
    const context = canvas.getContext('2d');
    if (context == null) return;
    drawCard(context, task);

    const texture = new CanvasTexture(canvas);
    texture.colorSpace = SRGBColorSpace;
    texture.anisotropy = 4;

    const edgeMaterial = new MeshStandardMaterial({ color: 0xe9d7bf, roughness: 0.6 });
    const faceMaterial = new MeshStandardMaterial({
      map: texture,
      emissiveMap: texture,
      emissive: 0xffffff,
      emissiveIntensity: 0.35,
      roughness: 0.75,
    });
    const mesh = new Mesh(new BoxGeometry(CARD_WIDTH, CARD_HEIGHT, CARD_DEPTH), [
      edgeMaterial,
      edgeMaterial,
      edgeMaterial,
      edgeMaterial,
      faceMaterial,
      edgeMaterial,
    ]);
    mesh.name = `Task Card: ${task.title}`;
    if (spawnAtButton) {
      const angle = COLUMN_ANGLES[TODO];
      mesh.position.set(polarX(angle, CARD_RADIUS), ADD_BUTTON_Y, polarZ(angle, CARD_RADIUS));
    }

    const entity = this.world.createTransformEntity(mesh, { persistent: true });
    entity.addComponent(TaskCard, { taskId: task.id });
    entity.addComponent(RayInteractable);
    entity.addComponent(OneHandGrabbable);

    const view: CardView = {
      entity,
      task,
      context,
      texture,
      edgeMaterial,
      targetPosition: new Vector3(),
      targetQuaternion: new Quaternion(),
      grabbed: false,
      pressStartedAt: 0,
      lastAdvanceAt: 0,
    };
    this.views.set(entity, view);
    this.viewList.push(view);
  }

  private layoutCards(snap: boolean): void {
    for (const column of [TODO, DOING, DONE]) {
      const angle = COLUMN_ANGLES[column];
      const inColumn = this.viewList
        .filter((view) => view.task.column === column)
        .sort((a, b) => a.task.order - b.task.order);
      const step =
        inColumn.length > 1
          ? Math.min(CARD_SLOT_STEP, CARD_COLUMN_SPAN / (inColumn.length - 1))
          : CARD_SLOT_STEP;
      inColumn.forEach((view, slot) => {
        const y = CARD_SLOT_TOP_Y - slot * step;
        // Slightly staggered depth so compressed cards never z-fight.
        const radius = CARD_RADIUS - slot * 0.004;
        view.targetPosition.set(polarX(angle, radius), y, polarZ(angle, radius));
        this.helper.position.copy(view.targetPosition);
        this.helper.lookAt(this.origin.set(0, y, 0));
        view.targetQuaternion.copy(this.helper.quaternion);
        const object = view.entity.object3D;
        if (snap && object) {
          object.position.copy(view.targetPosition);
          object.quaternion.copy(view.targetQuaternion);
        }
      });
    }
  }

  private async createHeaders(): Promise<void> {
    for (let column = 0; column < COLUMN_TITLES.length; column++) {
      const panel = await this.world.assets.instantiate<UIKitMLAsset>('kanban-column');
      const angle = COLUMN_ANGLES[column];
      const radius = CARD_RADIUS + 0.01;
      panel.position.set(polarX(angle, radius), COLUMN_HEADER_Y, polarZ(angle, radius));
      panel.lookAt(0, COLUMN_HEADER_Y, 0);
      panel.scale.setScalar(0.1);
      this.world.createTransformEntity(panel, { persistent: true });
      panel.getElementById('title')?.setProperties({ text: COLUMN_TITLES[column] });
      this.headers[column] = {
        count: panel.getElementById('count') as ColumnHeader['count'],
      };
    }
    this.updateCounts();
  }

  private updateCounts(): void {
    this.headers.forEach((header, column) => {
      const count = focusStore.liveTasks().filter((task) => task.column === column).length;
      header.count?.setProperties({ text: String(count) });
    });
  }
}
