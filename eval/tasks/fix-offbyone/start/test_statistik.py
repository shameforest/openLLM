from statistik import mittelwert, median


def test_mittelwert():
    assert mittelwert([1, 2, 3]) == 2
    assert mittelwert([2, 4]) == 3
    assert mittelwert([5]) == 5


def test_median_ungerade():
    assert median([3, 1, 2]) == 2
    assert median([7]) == 7
    assert median([9, 1, 5, 3, 7]) == 5


def test_median_gerade():
    assert median([1, 2, 3, 4]) == 2.5
    assert median([4, 1]) == 2.5
    assert median([10, 2, 8, 4]) == 6


if __name__ == "__main__":
    test_mittelwert()
    test_median_ungerade()
    test_median_gerade()
    print("alle Tests bestanden")
