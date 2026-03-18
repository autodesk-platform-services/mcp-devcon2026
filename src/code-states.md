---
title: Source Code
aside: false
---

# Source Code

Browse the complete source code at each milestone of the workshop. Select a snapshot to explore the files, then download individual files or the entire snapshot as a `.zip`.

<script setup>
import { data } from './code-states.data.js'
</script>

<div class="code-browser-wide">
  <CodeBrowser :states="data.states" />
</div>
