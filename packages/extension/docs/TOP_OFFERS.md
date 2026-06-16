### Offer Calculator Guide

A2 is the projected selling price

### Offer Max

=IF(A2 < 50, FLOOR(A2 * 0.2, 5), IF(A2 < 100, FLOOR(A2 * 0.25, 5), IF(A2 < 200, FLOOR(A2 * 0.3, 5), IF(A2 < 500, FLOOR(A2 * 0.4, 5), IF(A2 < 750, FLOOR(A2 * 0.5, 5), FLOOR(A2 * 0.6, 5))))))

### Offer Starting

=IF(A2 < 50, FLOOR(A2 * 0.1, 5), IF(A2 < 100, FLOOR(A2 * 0.2, 5), IF(A2 < 200, FLOOR(A2 * 0.25, 5), IF(A2 < 500, FLOOR(A2 * 0.3, 5), IF(A2 < 750, FLOOR(A2 * 0.4, 5), FLOOR(A2 * 0.5, 5))))))

### Premium Offer Max

=IF(A2 < 50, FLOOR(A2 * 0.2, 5), IF(A2 < 100, FLOOR(A2 * 0.25, 5), IF(A2 < 200, FLOOR(A2 * 0.3, 5), IF(A2 < 500, FLOOR(A2 * 0.5, 5), IF(A2 < 750, FLOOR(A2 * 0.6, 5), FLOOR(A2 * 0.7, 5))))))

### Premium Offer Starting

=IF(A2 < 50, FLOOR(A2 * 0.1, 5), IF(A2 < 100, FLOOR(A2 * 0.2, 5), IF(A2 < 200, FLOOR(A2 * 0.25, 5), IF(A2 < 500, FLOOR(A2 * 0.45, 5), IF(A2 < 750, FLOOR(A2 * 0.55, 5), FLOOR(A2 * 0.65, 5))))))

### Checkout Offer

Starting: `=FLOOR(A2 * 0.65, 5)`

Max: `=FLOOR(A2 * 0.8, 5)`
