
const DPI = 300;
const mmToPx = mm => Math.round(mm * DPI / 25.4);

const state = {
  electionId: null,
  positions: [],
  layout: [],
  savedTemplateId: null,
  copies: 2
};

const el = id => document.getElementById(id);

const esc = value => String(value ?? '')
  .replace(/[&<>"']/g, ch => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[ch]));

function status(message, error = false) {
  el('status').textContent = message;
  el('status').style.color = error ? '#a00' : '#333';
}

function layoutBallot() {
  const rows = [];
  let y = 36;
  const bottom = state.copies === 2 ? 137 : 283;

  for (const position of state.positions) {
    if (!position.candidates.length) continue;

    const headingY = y;
    y += 8;

    for (const candidate of position.candidates) {
      if (y + 7 > bottom) {
        throw new Error(
          'Too many candidates. Choose 1 ballot per A4 or reduce candidates.'
        );
      }

      rows.push({
        candidate,
        position,
        x: 18,
        y
      });

      y += 7;
    }

    y += 3;
    position._headingY = headingY;
  }

  return rows;
}

function addRegistrationMarks(half) {
  const bottom = state.copies === 2 ? 139 : 287;
  const marks = [
    [8, 6],
    [199, 6],
    [8, bottom],
    [199, bottom]
  ];

  for (const [left, top] of marks) {
    const mark = document.createElement('span');
    mark.className = 'registration-mark';
    mark.style.left = `${left}mm`;
    mark.style.top = `${top}mm`;
    half.appendChild(mark);
  }
}

function createHalf() {
  const half = document.createElement('section');
  half.className = 'ballot-half' + (state.copies === 1 ? ' full' : '');

  addRegistrationMarks(half);

  const title = el('titleInput').value.trim()
    || 'Official Election Ballot';

  const year = el('yearInput').value.trim();
  const instructions = el('instructionsInput').value.trim();

  const heading = document.createElement('div');
  heading.className = 'ballot-heading';

  heading.innerHTML = `
    <h1>${esc(title)}</h1>
    <p>Academic Year: ${esc(year)}</p>
    <p>${esc(instructions)}</p>
    <p>Template ID: ${state.savedTemplateId ?? 'UNSAVED'}</p>
  `;

  half.appendChild(heading);

  for (const position of state.positions) {
    if (!position.candidates.length) continue;

    const p = document.createElement('div');
    p.className = 'position-heading';
    p.style.top = `${position._headingY}mm`;
    p.textContent =
      `${position.title} — Select up to ${position.max_selection}`;

    half.appendChild(p);

    const candidates = state.layout.filter(
      row => row.position === position
    );

    for (const row of candidates) {
      const line = document.createElement('div');
      line.className = 'candidate-line';
      line.style.top = `${row.y}mm`;

      line.innerHTML = `
        <span class="omr-bubble"></span>
        <span>${esc(row.candidate.name)}</span>
      `;

      half.appendChild(line);
    }
  }

  return half;
}

function render() {
  state.layout = layoutBallot();

  const page = el('ballotPage');
  page.replaceChildren(
    ...Array.from({ length: state.copies }, () => createHalf())
  );

  el('loadedCandidates').textContent =
    state.positions.map(p =>
      `${p.title}: ${p.candidates.length} candidate(s)`
    ).join(' | ') || 'No candidates found';
}

async function loadData() {
  try {
    status('Loading positions and candidates...');

    const id = new URLSearchParams(location.search)
      .get('election_id') || '1';

    const [election, result] = await Promise.all([
      BallotAPI.resolveElection(id),
      BallotAPI.getPositions(id)
    ]);

    const positions = Array.isArray(result)
      ? result
      : result.positions;

    if (!Array.isArray(positions)) {
      throw new Error('Unexpected positions API response');
    }

    state.electionId = Number(election.election_id);

    state.positions = positions.map(p => ({
      id: Number(p.position_id),
      title: p.title,
      max_selection: Number(p.max_selection || 1),
      candidates: (p.candidates || []).map(c => ({
        id: Number(c.candidate_id),
        name: c.name
      }))
    }));

    state.savedTemplateId = null;
    state.copies = Number(el('copiesInput').value);

    renderPositionSettings();

    el('titleInput').value =
      election.title || 'Official Election Ballot';

    render();

    status(
      `Loaded ${state.positions.length} positions and ` +
      `${state.layout.length} candidates. ` +
      `Each A4 prints ${state.copies} ballot(s).`
    );

  } catch (error) {
    console.error(error);
    status(error.message, true);
  }
}

function coordinatePayload() {
  return state.layout.map(({ candidate, x, y }) => ({
    candidate_id: candidate.id,
    bubble_code: `C${candidate.id}`,
    x_pos: mmToPx(x),
    y_pos: mmToPx(y),
    width: mmToPx(5),
    height: mmToPx(5)
  }));
}

function invalidateAndRender() {
  state.savedTemplateId = null;

  try {
    render();
    status('Layout changed. Save a new template before printing.');
  } catch (error) {
    status(error.message, true);
  }
}

function renderPositionSettings() {
  const container = el('positionSettings');
  container.replaceChildren();

  for (const position of state.positions) {
    if (!position.candidates.length) continue;

    const label = document.createElement('label');
    label.textContent =
      `${position.title} (${position.candidates.length} candidates)`;

    const input = document.createElement('input');
    input.type = 'number';
    input.min = '1';
    input.max = String(position.candidates.length);
    input.value = String(position.max_selection);
    input.dataset.positionId = String(position.id);

    input.addEventListener('change', () => {
      const value = Number(input.value);

      if (
        !Number.isSafeInteger(value) ||
        value < 1 ||
        value > position.candidates.length
      ) {
        input.value = String(position.max_selection);
        return status(
          `Choose 1 to ${position.candidates.length} for ${position.title}.`,
          true
        );
      }

      position.max_selection = value;
      invalidateAndRender();
    });

    container.append(label, input);
  }
}

async function savePositionLimits() {
  for (const position of state.positions) {
    if (!position.candidates.length) continue;

    await BallotAPI.updatePosition(position.id, {
      max_selection: position.max_selection
    });
  }
}

async function saveBallot() {
  try {
    if (!state.electionId) {
      throw new Error('Election has not loaded.');
    }

    if (!state.layout.length) {
      throw new Error('No candidates to save.');
    }

    const title = el('titleInput').value.trim();

    if (!title) {
      throw new Error('Ballot title is required.');
    }

    if (state.savedTemplateId) {
      throw new Error(
        'Already saved. Reload Database to create another template.'
      );
    }

    await savePositionLimits();

    const result = await BallotAPI.saveCompleteTemplate({
      election_id: state.electionId,
      template_name: title,
      paper_size: state.copies === 2 ? 'A5' : 'A4',
      coordinates: coordinatePayload()
    });

    state.savedTemplateId = result.template.template_id;

    render();

    status(
      `Saved template #${state.savedTemplateId} with ` +
      `${state.layout.length} bubble coordinates. ` +
      'Print at 100% scale.'
    );

  } catch (error) {
    console.error(error);
    status(`Save failed: ${error.message}`, true);
  }
}

function printBallot() {
  if (!state.layout.length) {
    return status('No candidates to print.', true);
  }

  if (!state.savedTemplateId) {
    return status('Save Ballot first.', true);
  }

  window.print();
}

document.addEventListener('DOMContentLoaded', () => {
  el('reloadButton').addEventListener('click', loadData);

  el('copiesInput').addEventListener('change', () => {
    state.copies = Number(el('copiesInput').value);
    invalidateAndRender();
  });

  el('saveButton').addEventListener('click', saveBallot);
  el('printButton').addEventListener('click', printBallot);

  for (const id of [
    'titleInput',
    'yearInput',
    'instructionsInput'
  ]) {
    el(id).addEventListener('input', () => {
      if (state.savedTemplateId) {
        state.savedTemplateId = null;
        status(
          'Ballot changed. Save a new template before printing.'
        );
      }

      try {
        render();
      } catch (error) {
        status(error.message, true);
      }
    });
  }

  loadData();
});
