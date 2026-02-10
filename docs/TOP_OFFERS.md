### Top Offer Calculations From Google Sheets

A2 is the projected selling price

### Top Offer

=IF(A2 < 50, FLOOR(A2 _ 0.2, 5), IF(A2 < 100, FLOOR(A2 _ 0.3, 5), IF(A2 < 250, FLOOR(A2 _ 0.35, 5), IF(A2 < 500, FLOOR(A2 _ 0.45, 5), IF(A2 < 750, FLOOR(A2 _ 0.5, 5), FLOOR(A2 _ 0.6, 5))))))

### Top Offer (Premium)

=IF(A2 < 50, FLOOR(A2 _ 0.2, 5),
IF(A2 < 100, FLOOR(A2 _ 0.3, 5),
IF(A2 < 200, FLOOR(A2 _ 0.35, 5),
IF(A2 < 250, FLOOR(A2 _ 0.45, 5),
IF(A2 < 500, FLOOR(A2 _ 0.55, 5),
IF(A2 < 750, FLOOR(A2 _ 0.6, 5), FLOOR(A2 \* 0.7, 5)))))))

### Top Offer (Checkout)

=FLOOR(A2\*0.8, 5)

### Top Offer [Southgate]

=IF(A2 < 50, FLOOR(A2 _ 0.3, 5), IF(A2 < 100, FLOOR(A2 _ 0.35, 5), IF(A2 < 250, FLOOR(A2 _ 0.45, 5), IF(A2 < 500, FLOOR(A2 _ 0.55, 5), IF(A2 < 750, FLOOR(A2 _ 0.6, 5), FLOOR(A2 _ 0.7, 5))))))

### Top Offer (Premium) [Southgate]

=IF(A2 < 50, FLOOR(A2 _ 0.3, 5),
IF(A2 < 100, FLOOR(A2 _ 0.35, 5),
IF(A2 < 200, FLOOR(A2 _ 0.45, 5),
IF(A2 < 250, FLOOR(A2 _ 0.55, 5),
IF(A2 < 500, FLOOR(A2 _ 0.65, 5),
IF(A2 < 750, FLOOR(A2 _ 0.7, 5), FLOOR(A2 \* 0.75, 5)))))))
