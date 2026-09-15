#!/usr/bin/env bash
# Deletes the 47 remote branches already merged into main, as of 2026-08-28.
# Excluded on purpose: main, stable, and claude/client-variation-approval-7ca5uj.
# Every branch below is fully contained in main — nothing unique is lost.
# To restore one:  git push origin <sha>:refs/heads/<branch>   (SHAs in the table at the end)
set -euo pipefail
git fetch origin --prune
BRANCHES=(
  claude/accepted-quotes-snapshot-wn8m58
  claude/app-availability-merge-status-p0w7a9
  claude/app-layout-reorganization-dvtk0c
  claude/app-upgrades-part-2-hel31j
  claude/bottom-row-icon-layout-avxedr
  claude/bulk-doorframe-prep
  claude/bulk-edit-products-prep
  claude/bulk-room-edit
  claude/calibration-phase-c-q2emaa
  claude/estimating-app-pricing-ki5asx
  claude/exterior-material-override-lpccmv
  claude/feature-wall-room-addition-f4jlr4
  claude/fitted-furniture-door-pricing-1j59px
  claude/fitted-unit-accuracy-9ep5vs
  claude/fitted-unit-naming-dmm66e
  claude/floating-bar-ua8d2f
  claude/job-rounding-calculation-4tl337
  claude/kitchen-collapsed-item-count-4uw3ev
  claude/kitchen-tab-consolidation-q2r987
  claude/labour-upcharge-rounding-spread-6jyase
  claude/layout-clarity-review-y6eg15
  claude/manual-job-saturday-545fka
  claude/missing-job-id-indexes-5j6uqp
  claude/odd-shaped-room-handling-nzxew6
  claude/on-site-next-updating-cj6erf
  claude/onsite-materials-editing-8x55z5
  claude/paint-quantities-room-summary-i58bg0
  claude/price-lookup-feature-9pmvho
  claude/product-coverage-rates-e0exz3
  claude/product-coverage-rates-r9hfj9
  claude/quote-acceptance-xero-sync-taomgr
  claude/quote-preview-print-pdf-h42p7i
  claude/ral-classic-colours-qkusj9
  claude/room-form-reorder-wallpaper-kv9tn3
  claude/room-section-reorder-5tgvbo
  claude/schedule-calendar-parity-nkgmoj
  claude/schedule-subscribed-calendar-display-ero5qe
  claude/staircase-timing-settings-g9q20l
  claude/standalone-job-rounding-ch12w6
  claude/strip-coating-kitchen-5o3d64
  claude/user-manual-illustrations-esd6o9
  claude/user-manual-update-owhhv6
  claude/window-pricing-selector-k3soad
  claude/xero-import-job-fields-l8mge2
  claude/xero-invoice-material-colour-a77wve
  claude/xero-prepayment-integration-oxl07j
  claude/xero-quote-reference-fix
)
# Re-verify each is still merged before deleting — refuses anything that moved.
for b in "${BRANCHES[@]}"; do
  if ! git merge-base --is-ancestor "origin/$b" origin/main 2>/dev/null; then
    echo "SKIP (not merged / gone): $b"; continue
  fi
  echo "deleting $b"
  git push origin --delete "$b"
done
--- restore manifest (sha  branch) ---
# e09ee00f07d6b743a7ffdc6a917d457be88c7c8c  claude/accepted-quotes-snapshot-wn8m58
# d9207e19b7535f749f839f1126cc8ecd1b3bf465  claude/app-availability-merge-status-p0w7a9
# ed9867315df909284f97b9dd175cf24fa8ced327  claude/app-layout-reorganization-dvtk0c
# bea3df4fcceb2f22f790a646ddd224f22e59e319  claude/app-upgrades-part-2-hel31j
# c804809a9b545e2b5a7c6a0fb8480a42d329217e  claude/bottom-row-icon-layout-avxedr
# 2414ea703273b3be6225217d37186dd292e42dbc  claude/bulk-doorframe-prep
# 9f6eac53ee77acd690f7a3b014d87e52882de060  claude/bulk-edit-products-prep
# 36fb01c2a1999a879aa000cc12a515b7b9c95552  claude/bulk-room-edit
# 9cf74f5aee81fe8882c196c8da5d7d4128abeef6  claude/calibration-phase-c-q2emaa
# 2d9299dea9cd516cc964e39c98b3344c7179fde8  claude/estimating-app-pricing-ki5asx
# 1c5a6849ccbf34baf62d3a754a00e5d0fe0a2487  claude/exterior-material-override-lpccmv
# 91384fd44aa8b1a03cf119e555bdae4ff0e298af  claude/feature-wall-room-addition-f4jlr4
# fdcdfd6277c47861c04871fcee2d826176dd65a1  claude/fitted-furniture-door-pricing-1j59px
# 36d9fe0924f7a7940d4aeaea61f395c91d927518  claude/fitted-unit-accuracy-9ep5vs
# b69ac44ff3bf19b264e68d7e3999aeae64495fad  claude/fitted-unit-naming-dmm66e
# 179d37cec73d09ad92aecb9aa0f7f626dd175def  claude/floating-bar-ua8d2f
# cc8b87afeb05cfd01ab85579a777f772073b218c  claude/job-rounding-calculation-4tl337
# 8a0363d0cafcc17a1825b1d91e3d7f03bf3ccbbd  claude/kitchen-collapsed-item-count-4uw3ev
# 35036f2336675176b76789459e8245a01f1f8415  claude/kitchen-tab-consolidation-q2r987
# 20c79091737f59792faa782be7e9ddb7bdd41a0c  claude/labour-upcharge-rounding-spread-6jyase
# 95b3ed6156f24448d40dbb3ef4712fd470a0fcc0  claude/layout-clarity-review-y6eg15
# 38bec2e7d68b775468845252377b1c4ea5e1de57  claude/manual-job-saturday-545fka
# b732280fc8340219ae4dc9f16421a4b770883cc9  claude/missing-job-id-indexes-5j6uqp
# 22e17a1e1b749460866d6c5a86d5ac91e3614b92  claude/odd-shaped-room-handling-nzxew6
# 18a85516efd5e560bf6b2de9c430ef03890821fd  claude/on-site-next-updating-cj6erf
# ea02cf691b98873f161a27d36bfb189b4d9a38fd  claude/onsite-materials-editing-8x55z5
# ba0e47275c962382f20c44af8749a2ed48c4476c  claude/paint-quantities-room-summary-i58bg0
# 0f2c9a78faab0f04baa26487b320d7479d9834d9  claude/price-lookup-feature-9pmvho
# 20c0ed69fa38dad4b81dcf4d75f542436e9ae3c6  claude/product-coverage-rates-e0exz3
# 195bdcf6b918f2fa49c808a8c454002b1f558f7d  claude/product-coverage-rates-r9hfj9
# 9cfef66c789a5c97e815f14fbe4f0c4845e02d9d  claude/quote-acceptance-xero-sync-taomgr
# 9f4db9613d65f7ec35be485c849110fafb25ba58  claude/quote-preview-print-pdf-h42p7i
# 1b23e69d7808ebfb59d2f5be8d79184ae9a94a70  claude/ral-classic-colours-qkusj9
# c28c7d42b57e0150c7588a7ccaa006993e5f92cf  claude/room-form-reorder-wallpaper-kv9tn3
# d52b2e8f376cf0e37bf856640b325bf6f88f3ff5  claude/room-section-reorder-5tgvbo
# 88d898f38f08dc768513b9413529f7bc089a148a  claude/schedule-calendar-parity-nkgmoj
# 8dec827e6e4a73b716f1a94d77eb2e46499ad757  claude/schedule-subscribed-calendar-display-ero5qe
# 2e8e3f67485296aee81e707cc143495e45464aa7  claude/staircase-timing-settings-g9q20l
# 1b854e9035f857e4a0eacf5c359a9b85162e23bf  claude/standalone-job-rounding-ch12w6
# 0994f255c1954e0a692e5b2ecf23c1ccbebd62ca  claude/strip-coating-kitchen-5o3d64
# 7079b949c7b951352d74d78dd02fa31abcf709ab  claude/user-manual-illustrations-esd6o9
# eee4651a9f2ddc9012a1bfb3cc3be76dd2cfd90b  claude/user-manual-update-owhhv6
# ec97558aa5580fc4f515aff7d04aec5956f22587  claude/window-pricing-selector-k3soad
# 8878183f23a11f2497965d2486b80f31266d5725  claude/xero-import-job-fields-l8mge2
# 3b92ba109b0a361ca9ba7c1f613a5b84e50c6b54  claude/xero-invoice-material-colour-a77wve
# 2935f51c49da62d99fc77e17c37d7d0eb964f59d  claude/xero-prepayment-integration-oxl07j
# e8bce0366326fe0567c3ecb0a74cd7308429d2f0  claude/xero-quote-reference-fix
